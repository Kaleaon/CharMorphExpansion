"""Tests for FastAPI web application endpoints and asyncio thread pool offloading."""

from __future__ import annotations

import asyncio
import io
import threading
import time
import zipfile
from pathlib import Path

import httpx
import pytest

from webapp import server, processing
from webapp.server import app, _save_file_sync


@pytest.fixture
def create_zip_bytes():
    """Helper fixture to generate a valid zip file in memory containing a model file."""
    def _make_zip(filename: str = "test_character.obj", content: bytes = b"v 0 0 0\nv 1 1 1\n") -> bytes:
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr(filename, content)
        return buf.getvalue()
    return _make_zip


@pytest.mark.asyncio
async def test_healthcheck():
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/health")
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}


@pytest.mark.asyncio
async def test_list_base_meshes():
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/base-meshes")
        assert response.status_code == 200
        data = response.json()
        assert "items" in data
        assert isinstance(data["items"], list)
        assert "HumanoidNeutral" in data["items"]


@pytest.mark.asyncio
async def test_ingest_model_success(create_zip_bytes):
    zip_bytes = create_zip_bytes("character.obj", b"v 0 0 0\nv 1 0 0\n")
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        files = {"files": ("model.zip", zip_bytes, "application/zip")}
        data = {"base_mesh_id": "HumanoidNeutral"}
        response = await client.post("/ingest-model", files=files, data=data)
        assert response.status_code == 200
        report = response.json()
        assert report["success"] is True
        assert report["base_mesh"] == "HumanoidNeutral"
        assert len(report["layer_summaries"]) > 0
        assert "slider_metadata" in report["generated_assets"]


@pytest.mark.asyncio
async def test_ingest_model_unsupported_file():
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        files = {"files": ("document.pdf", b"pdf content", "application/pdf")}
        data = {"base_mesh_id": "HumanoidNeutral"}
        response = await client.post("/ingest-model", files=files, data=data)
        assert response.status_code == 400
        assert "No supported 3D model files" in response.json()["detail"]


@pytest.mark.asyncio
async def test_healthcheck_responsiveness_during_ingest(create_zip_bytes, monkeypatch):
    """Verify GET /health responds within 10ms while POST /ingest-model is actively executing."""
    main_thread_id = threading.get_ident()
    ingest_thread_ids = []

    original_run = processing.ModelIngestionPipeline.run

    def slow_run(self):
        ingest_thread_ids.append(threading.get_ident())
        # Sleep in worker thread to simulate heavy ingestion work
        time.sleep(0.3)
        return original_run(self)

    monkeypatch.setattr(processing.ModelIngestionPipeline, "run", slow_run)

    zip_bytes = create_zip_bytes("heavy_model.obj", b"v 0 0 0\n")

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        # Start heavy ingestion task
        files = {"files": ("heavy_model.zip", zip_bytes, "application/zip")}
        ingest_task = asyncio.create_task(client.post("/ingest-model", files=files))

        # Wait briefly for ingest_task to begin processing
        await asyncio.sleep(0.05)

        # Measure health check latency during ingestion
        health_latencies = []
        for _ in range(10):
            start = time.perf_counter()
            health_resp = await client.get("/health")
            elapsed_ms = (time.perf_counter() - start) * 1000.0
            health_latencies.append(elapsed_ms)
            assert health_resp.status_code == 200
            await asyncio.sleep(0.01)

        ingest_resp = await ingest_task
        assert ingest_resp.status_code == 200

        # Verify pipeline.run executed on a worker thread, not the main thread
        assert len(ingest_thread_ids) > 0
        for tid in ingest_thread_ids:
            assert tid != main_thread_id

        # Verify all health check responses took well under 10ms (or max 10ms)
        max_latency = max(health_latencies)
        assert max_latency < 10.0, f"Max health check latency was {max_latency:.2f} ms, target < 10 ms"


@pytest.mark.asyncio
async def test_store_upload_runs_in_worker_thread(tmp_path, monkeypatch):
    """Verify _store_upload offloads file writing to worker threads."""
    main_thread_id = threading.get_ident()
    save_thread_ids = []

    def mock_save_file_sync(file_obj, destination: Path) -> None:
        save_thread_ids.append(threading.get_ident())
        _save_file_sync(file_obj, destination)

    monkeypatch.setattr("webapp.server._save_file_sync", mock_save_file_sync)

    zip_bytes = b"v 0 0 0\n"
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        files = {"files": ("test.obj", zip_bytes, "text/plain")}
        resp = await client.post("/ingest-model", files=files)
        assert resp.status_code == 200

    assert len(save_thread_ids) > 0
    for tid in save_thread_ids:
        assert tid != main_thread_id


@pytest.mark.asyncio
async def test_max_concurrent_uploads_semaphore(create_zip_bytes, monkeypatch):
    """Verify worker pool capacity limit prevents over-concurrency."""
    concurrent_active = 0
    max_observed_active = 0
    lock = threading.Lock()

    original_run = processing.ModelIngestionPipeline.run

    def tracked_run(self):
        nonlocal concurrent_active, max_observed_active
        with lock:
            concurrent_active += 1
            if concurrent_active > max_observed_active:
                max_observed_active = concurrent_active
        try:
            time.sleep(0.1)
            return original_run(self)
        finally:
            with lock:
                concurrent_active -= 1

    monkeypatch.setattr(processing.ModelIngestionPipeline, "run", tracked_run)

    zip_bytes = create_zip_bytes("model.obj", b"v 0 0 0\n")

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        files = {"files": ("model.zip", zip_bytes, "application/zip")}
        tasks = [client.post("/ingest-model", files=files) for _ in range(5)]
        responses = await asyncio.gather(*tasks)

        for resp in responses:
            assert resp.status_code == 200

    assert max_observed_active <= server.MAX_CONCURRENT_UPLOADS

