# CharMorph Android App

This is the Android application for CharMorph, a detailed character design tool.

## Architecture

The app follows a modular architecture:

- **app**: The main application module containing UI (Compose) and navigation.
- **core-model**: Shared data structures (`Mesh`, `Skeleton`, `MorphTarget`) and domain entities.
- **ingest-pipeline**: WorkManager tasks for importing and processing 3D assets.
  - `PrepareUploadsWorker`: Handles file copying.
  - `ParseMeshWorker`: Parses 3D formats (OBJ/GLTF) via JNI.
  - `FeatureExtractionWorker`: Prepares data for ML.
  - `MLFittingWorker`: Runs TFLite models to fit clothes/skin.
  - `SliderSynthesisWorker`: Generates UI sliders from morph data.
- **ml-engine**: TensorFlow Lite wrappers and inference logic.
- **asset-base**: Manages built-in assets (base meshes, skeletons).
- **storage**: Room database for persisting character metadata and import history.
- **native-bridge**: JNI interface to C++ libraries (Assimp, Eigen) for heavy geometry processing.
- **preview-renderer**: A lightweight 3D renderer (likely Filament or Sceneform based) for previewing characters.

## Development Status

- [x] Module scaffolding
- [x] Core data models
- [x] Basic UI shell (Home, Import screens)
- [x] Ingestion pipeline worker stubs
- [ ] JNI implementation for mesh parsing
- [ ] TFLite model integration
- [ ] 3D Preview rendering

## References

- **MakeHuman**: The morphing system is inspired by MakeHuman's target-based approach.
- **Shape Atlas**: Anatomical accuracy is a key goal, ensuring muscle deformers respect realistic biomechanics.
