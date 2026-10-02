import sys
import unittest
from unittest.mock import MagicMock, patch
import urllib.error
import socket
import json

import tests.conftest

from CharMorphExpansion.addon_updater import SingletonUpdater
from CharMorphExpansion import addon_updater_ops


class TestAddonUpdaterErrorHandling(unittest.TestCase):

    def setUp(self):
        self.updater = SingletonUpdater()
        self.updater.user = "test_user"
        self.updater.repo = "test_repo"
        self.updater.current_version = (1, 0, 0)

    @patch('urllib.request.urlopen')
    def test_get_raw_timeout_error(self, mock_urlopen):
        mock_urlopen.side_effect = TimeoutError("Connection timed out")
        result = self.updater.get_raw("https://example.com/api")
        self.assertIsNone(result)
        self.assertEqual(self.updater.error, "URL error, check internet connection")
        self.assertIn("timed out", self.updater.error_msg)

    @patch('urllib.request.urlopen')
    def test_get_raw_socket_timeout(self, mock_urlopen):
        mock_urlopen.side_effect = socket.timeout("socket timeout")
        result = self.updater.get_raw("https://example.com/api")
        self.assertIsNone(result)
        self.assertEqual(self.updater.error, "URL error, check internet connection")
        self.assertIn("socket timeout", self.updater.error_msg)

    @patch('urllib.request.urlopen')
    def test_get_raw_url_error(self, mock_urlopen):
        mock_urlopen.side_effect = urllib.error.URLError("host not found")
        result = self.updater.get_raw("https://example.com/api")
        self.assertIsNone(result)
        self.assertEqual(self.updater.error, "URL error, check internet connection")
        self.assertEqual(self.updater.error_msg, "host not found")

    @patch('urllib.request.urlopen')
    def test_get_raw_ssl_error(self, mock_urlopen):
        mock_urlopen.side_effect = urllib.error.URLError("SSL certificate verify failed")
        result = self.updater.get_raw("https://example.com/api")
        self.assertIsNone(result)
        self.assertEqual(self.updater.error, "Connection rejected, download manually")
        self.assertIn("SSL", self.updater.error_msg)

    @patch('urllib.request.urlopen')
    def test_get_raw_http_error(self, mock_urlopen):
        mock_urlopen.side_effect = urllib.error.HTTPError(
            "https://example.com", 404, "Not Found", {}, None
        )
        result = self.updater.get_raw("https://example.com/api")
        self.assertIsNone(result)
        self.assertEqual(self.updater.error, "HTTP error")
        self.assertEqual(self.updater.error_msg, "404")

    @patch.object(SingletonUpdater, 'get_raw')
    def test_get_api_invalid_json_format(self, mock_get_raw):
        mock_get_raw.return_value = "invalid json {"
        result = self.updater.get_api("https://example.com/api")
        self.assertIsNone(result)
        self.assertEqual(self.updater.error, "API response has invalid JSON format")
        self.assertTrue(len(self.updater.error_msg) > 0)
        # Verify str(e) formatting works without raising AttributeError
        self.assertIsInstance(self.updater.error_msg, str)

    @patch.object(SingletonUpdater, 'get_raw')
    def test_get_api_valid_json(self, mock_get_raw):
        mock_get_raw.return_value = '{"tag_name": "v1.1.0"}'
        result = self.updater.get_api("https://example.com/api")
        self.assertEqual(result, {"tag_name": "v1.1.0"})

    @patch('CharMorphExpansion.addon_updater_ops.ui_refresh')
    def test_background_update_callback_trigger_redraw_on_error(self, mock_ui_refresh):
        addon_updater_ops.updater._error = "URL error"
        addon_updater_ops.updater.invalid_updater = False
        addon_updater_ops.background_update_callback(False)
        mock_ui_refresh.assert_called_once_with(False)

    def test_scene_handlers_safely_catch_exceptions(self):
        mock_bpy = sys.modules['bpy']
        mock_bpy.ops.charmorph = MagicMock()
        if not hasattr(mock_bpy.app.handlers, 'scene_update_post'):
            mock_bpy.app.handlers.scene_update_post = MagicMock()
        if not hasattr(mock_bpy.app.handlers, 'depsgraph_update_post'):
            mock_bpy.app.handlers.depsgraph_update_post = MagicMock()

        # Force handler removal to fail by mocking handlers without the method
        mock_bpy.app.handlers.scene_update_post.remove = MagicMock(side_effect=Exception("Handler remove failed"))
        mock_bpy.app.handlers.depsgraph_update_post.remove = MagicMock(side_effect=Exception("Handler remove failed"))

        # Should not raise exception
        try:
            addon_updater_ops.updater_run_install_popup_handler(None)
            addon_updater_ops.updater_run_success_popup_handler(None)
        except Exception as e:
            self.fail(f"Handler raised unexpected exception: {e}")


if __name__ == '__main__':
    unittest.main()
