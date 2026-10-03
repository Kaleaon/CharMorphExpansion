"""Integration tests for webapp server endpoints and asset persistence."""

import json
from pathlib import Path

from fastapi.testclient import TestClient
import pytest

from webapp.server import app

HUMANOID_NEUTRAL_XML = """<BaseMesh name="HumanoidNeutral" version="1.0">
  <Metadata>
    <Description>Humanoid Neutral Base Mesh</Description>
  </Metadata>
  <Topology unit="meters">
    <Vertices>
      <Vertex id="0" x="0.0" y="0.0" z="0.0"/>
      <Vertex id="1" x="0.0" y="1.0" z="0.0"/>
      <Vertex id="2" x="1.0" y="0.0" z="0.0"/>
    </Vertices>
    <Faces>
      <Face verts="0,1,2"/>
    </Faces>
  </Topology>
  <Rig>
    <Bone name="root" x="0.0" y="0.0" z="0.0" tail_x="0.0" tail_y="1.0" tail_z="0.0"/>
  </Rig>
  <WeightLayers>
    <Layer name="skin" type="skin" normalised="true">
      <Bone name="root">
        <Weight vertex="0" value="1.0"/>
        <Weight vertex="1" value="0.5"/>
      </Bone>
    </Layer>
  </WeightLayers>
  <Sizing>
    <Parameter name="height" value="1.75" unit="meters"/>
  </Sizing>
</BaseMesh>"""

HUMANOID_ATHLETIC_XML = """<BaseMesh name="HumanoidAthletic" version="1.0">
  <Metadata>
    <Description>Humanoid Athletic Base Mesh</Description>
  </Metadata>
  <Topology unit="meters">
    <Vertices>
      <Vertex id="0" x="0.0" y="0.0" z="0.0"/>
      <Vertex id="1" x="0.0" y="1.0" z="0.0"/>
      <Vertex id="2" x="1.0" y="0.0" z="0.0"/>
    </Vertices>
    <Faces>
      <Face verts="0,1,2"/>
    </Faces>
  </Topology>
  <Rig>
    <Bone name="root" x="0.0" y="0.0" z="0.0" tail_x="0.0" tail_y="1.0" tail_z="0.0"/>
  </Rig>
  <WeightLayers>
    <Layer name="skin" type="skin" normalised="true">
      <Bone name="root">
        <Weight vertex="0" value="1.0"/>
        <Weight vertex="1" value="0.5"/>
      </Bone>
    </Layer>
  </WeightLayers>
  <Sizing>
    <Parameter name="height" value="1.80" unit="meters"/>
  </Sizing>
</BaseMesh>"""


@pytest.fixture(autouse=True)
def ensure_base_meshes():
    base_mesh_dir = Path(__file__).resolve().parents[2] / "data" / "base_meshes"
    base_mesh_dir.mkdir(parents=True, exist_ok=True)
    neutral_file = base_mesh_dir / "HumanoidNeutral.xml"
    if not neutral_file.exists():
        neutral_file.write_text(HUMANOID_NEUTRAL_XML, encoding="utf-8")
    athletic_file = base_mesh_dir / "HumanoidAthletic.xml"
    if not athletic_file.exists():
        athletic_file.write_text(HUMANOID_ATHLETIC_XML, encoding="utf-8")


@pytest.fixture
def client():
    return TestClient(app)


def test_healthcheck(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_list_base_meshes(client):
    response = client.get("/base-meshes")
    assert response.status_code == 200
    data = response.json()
    assert "items" in data
    assert "HumanoidNeutral" in data["items"]


def test_ingest_model_persists_slider_metadata(client):
    """Verify slider_metadata.json persists in output_dir after ingestion response."""
    obj_content = b"v 0.0 0.0 0.0\nv 0.0 1.0 0.0\nv 1.0 0.0 0.0\nf 1 2 3\n"
    response = client.post(
        "/ingest-model",
        files=[("files", ("character.obj", obj_content, "model/obj"))],
        data={"base_mesh_id": "HumanoidNeutral"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True

    # Check generated slider metadata path
    generated_assets = payload.get("generated_assets", {})
    assert "slider_metadata" in generated_assets
    metadata_path = Path(generated_assets["slider_metadata"])

    # Verify metadata file is NOT removed by background tasks and remains accessible on disk
    assert metadata_path.exists(), f"Expected metadata file at {metadata_path} to exist"
    assert metadata_path.is_file()

    # Read and validate JSON contents
    with metadata_path.open("r", encoding="utf-8") as f:
        metadata_content = json.load(f)

    assert metadata_content["session_id"] == payload["session_id"]
    assert metadata_content["base_mesh"] == "HumanoidNeutral"
    assert "layers" in metadata_content


def test_ingest_model_cleans_up_upload_dir(client):
    """Verify uploaded source directory is cleaned up while output asset persists."""
    obj_content = b"v 0.0 0.0 0.0\nv 0.0 1.0 0.0\nv 1.0 0.0 0.0\nf 1 2 3\n"
    response = client.post(
        "/ingest-model",
        files=[("files", ("character.obj", obj_content, "model/obj"))],
        data={"base_mesh_id": "HumanoidNeutral"},
    )
    assert response.status_code == 200
    payload = response.json()

    # Check that processed upload path no longer exists (cleaned up by background tasks)
    processed_files = payload.get("processed_files", [])
    assert len(processed_files) > 0
    uploaded_file_path = Path(processed_files[0])
    upload_dir = uploaded_file_path.parent
    assert not upload_dir.exists(), f"Expected temporary upload dir {upload_dir} to be cleaned up"

    # Confirm output_dir with metadata still exists
    metadata_path = Path(payload["generated_assets"]["slider_metadata"])
    assert metadata_path.exists(), "Output metadata should be preserved"


def test_ingest_model_no_supported_files(client):
    """Verify uploading an unsupported file format returns 400."""
    response = client.post(
        "/ingest-model",
        files=[("files", ("notes.txt", b"plain text", "text/plain"))],
    )
    assert response.status_code == 400
    assert "No supported 3D model files" in response.json()["detail"]
