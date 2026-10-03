"""FastAPI application exposing CharMorph model ingestion endpoints."""

from __future__ import annotations

from pathlib import Path
from typing import List
import asyncio
import logging
import os
import shutil
import tempfile
import uuid

from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse

from . import processing

logger = logging.getLogger(__name__)

MAX_CONCURRENT_UPLOADS = int(os.getenv("MAX_CONCURRENT_UPLOADS", "2"))
_ingestion_semaphore = asyncio.Semaphore(MAX_CONCURRENT_UPLOADS)

app = FastAPI(
    title="CharMorph Model Ingestion API",
    description=(
        "Accepts rigged character uploads, analyses them against CharMorph base meshes, "
        "and generates weight/slider metadata for downstream authoring."
    ),
    version="0.1.0",
)


def _save_file_sync(file_obj, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    if hasattr(file_obj, "seek"):
        try:
            file_obj.seek(0)
        except Exception:
            pass
    with destination.open("wb") as buffer:
        shutil.copyfileobj(file_obj, buffer)


async def _store_upload(upload: UploadFile, target_dir: Path) -> Path:
    safe_name = upload.filename or f"upload_{uuid.uuid4().hex}"
    destination = target_dir / os.path.basename(safe_name)
    logger.debug("Persisting upload %s to %s", upload.filename, destination)
    await asyncio.to_thread(_save_file_sync, upload.file, destination)
    await upload.close()
    return destination


def _schedule_cleanup(background_tasks: BackgroundTasks, path: Path) -> None:
    background_tasks.add_task(shutil.rmtree, path, ignore_errors=True)


@app.get("/health")
async def healthcheck() -> dict:
    return {"status": "ok"}


@app.get("/base-meshes")
async def list_base_meshes() -> dict:
    items = await asyncio.to_thread(processing.available_base_mesh_ids)
    return {"items": items}


@app.post("/ingest-model")
async def ingest_model(
    background_tasks: BackgroundTasks,
    files: List[UploadFile] = File(..., description="3D model files or archives"),
    base_mesh_id: str = Form("HumanoidNeutral"),
) -> JSONResponse:
    if not files:
        raise HTTPException(status_code=400, detail="At least one file must be uploaded.")

    async with _ingestion_semaphore:
        upload_dir = Path(tempfile.mkdtemp(prefix="charmorph_web_upload_"))
        try:
            for upload in files:
                await _store_upload(upload, upload_dir)

            pipeline = processing.ModelIngestionPipeline(
                upload_root=upload_dir,
                base_mesh_id=base_mesh_id,
                dispose_source=True,
            )
            report = await asyncio.to_thread(pipeline.run)

            output_dir = pipeline.output_root / pipeline.session_id
            if output_dir.exists():
                _schedule_cleanup(background_tasks, output_dir)

            if not report.success:
                raise HTTPException(status_code=400, detail=report.message)

            return JSONResponse(report.to_dict())
        finally:
            if upload_dir.exists():
                _schedule_cleanup(background_tasks, upload_dir)
