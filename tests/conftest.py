import os
import sys

# Ensure repository root is on sys.path for test resolution
repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if repo_root not in sys.path:
    sys.path.insert(0, repo_root)

# Import sitecustomize to initialize test mocks and environment
import tests.sitecustomize as sitecustomize  # noqa: F401
