import sys
from unittest.mock import MagicMock

class DummyProp:
    def __init__(self, **kwargs):
        self.kwargs = kwargs

class MockBpyProps:
    _PropertyDeferred = DummyProp
    EnumProperty = MagicMock(side_effect=lambda **kw: DummyProp(**kw))
    PointerProperty = MagicMock(side_effect=lambda **kw: DummyProp(**kw))
    BoolProperty = MagicMock(side_effect=lambda **kw: DummyProp(**kw))
    StringProperty = MagicMock(side_effect=lambda **kw: DummyProp(**kw))
    FloatProperty = MagicMock(side_effect=lambda **kw: DummyProp(**kw))
    IntProperty = MagicMock(side_effect=lambda **kw: DummyProp(**kw))
    CollectionProperty = MagicMock(side_effect=lambda **kw: DummyProp(**kw))

class MockImagePreview:
    def __init__(self, name, filepath):
        self.name = name
        self.filepath = filepath
        self.icon_value = abs(hash(name)) % 1000000 + 1

class MockImagePreviewCollection(dict):
    def load(self, name, filepath, img_type):
        preview = MockImagePreview(name, filepath)
        self[name] = preview
        return preview

class MockPreviews:
    def __init__(self):
        self.collections = []

    def new(self):
        pcoll = MockImagePreviewCollection()
        self.collections.append(pcoll)
        return pcoll

    def remove(self, pcoll):
        if pcoll in self.collections:
            self.collections.remove(pcoll)

mock_previews_instance = MockPreviews()

def setup_mock_bpy():
    bpy = MagicMock()
    bpy.__path__ = []
    bpy.props = MockBpyProps()
    bpy.types.Panel = type('Panel', (object,), {})
    bpy.types.Operator = type('Operator', (object,), {})
    bpy.types.PropertyGroup = type('PropertyGroup', (object,), {})
    bpy.types.Object = type('Object', (object,), {})
    bpy.types.Mesh = type('Mesh', (object,), {})
    bpy.types.WindowManager = type('WindowManager', (object,), {})
    bpy.types.OperatorFileListElement = type('OperatorFileListElement', (object,), {})

    bpy.utils.previews = mock_previews_instance
    bpy.utils.register_classes_factory = lambda classes: (lambda: None, lambda: None)

    app = MagicMock()
    app.__path__ = []
    app.version = (3, 3, 0)
    handlers = MagicMock()
    handlers.__path__ = []
    handlers.persistent = lambda f: f

    app.handlers = handlers
    bpy.app = app

    sys.modules['bpy'] = bpy
    sys.modules['bpy.props'] = MockBpyProps()
    sys.modules['bpy.types'] = bpy.types
    sys.modules['bpy.utils'] = bpy.utils
    sys.modules['bpy.utils.previews'] = mock_previews_instance
    sys.modules['bpy.app'] = app
    sys.modules['bpy.app.handlers'] = handlers
    sys.modules['addon_utils'] = MagicMock()
    sys.modules['rna_prop_ui'] = MagicMock()
    sys.modules['idprop'] = MagicMock()

    bpy_extras = MagicMock()
    import_helper = type('ImportHelper', (object,), {})
    export_helper = type('ExportHelper', (object,), {})
    bpy_extras.io_utils.ImportHelper = import_helper
    bpy_extras.io_utils.ExportHelper = export_helper
    sys.modules['bpy_extras'] = bpy_extras
    sys.modules['bpy_extras.io_utils'] = bpy_extras.io_utils
    sys.modules['bpy_extras.wm_utils'] = MagicMock()
    sys.modules['bpy_extras.wm_utils.progress_report'] = MagicMock()

    if 'mathutils' not in sys.modules:
        mathutils = MagicMock()
        class MockMatrix(list):
            @staticmethod
            def Identity(n):
                return MockMatrix([[1 if i == j else 0 for j in range(n)] for i in range(n)])
            def copy(self):
                return MockMatrix([list(row) for row in self])
            @staticmethod
            def Rotation(angle, size, axis):
                return MockMatrix.Identity(size)
            def __matmul__(self, other):
                return other

        mathutils.Matrix = MockMatrix
        mathutils.Vector = MagicMock
        sys.modules['mathutils'] = mathutils

    bmesh = MagicMock()
    sys.modules['bmesh'] = bmesh

setup_mock_bpy()
