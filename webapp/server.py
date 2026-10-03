"""FastAPI application exposing CharMorph model ingestion endpoints."""

from __future__ import annotations

import logging

from fastapi import FastAPI

logger = logging.getLogger(__name__)

app = FastAPI(
    title="CharMorph Model Ingestion API",
    description=(
        "Accepts rigged character uploads, analyses them against CharMorph base meshes, "
        "and generates weight/slider metadata for downstream authoring."
    ),
    version="0.1.0",
)
