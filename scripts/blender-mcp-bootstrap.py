"""Enable the verified local MCP bridge in Blender GUI; no scene operations.

Opening, inspecting, editing, saving and rendering projects must use MCP calls.
The launcher supplies an isolated BLENDER_USER_CONFIG / BLENDER_USER_SCRIPTS.
"""
import hashlib
import os
from pathlib import Path

import addon_utils
import bpy

addon_file = Path(os.environ["BLENDER_USER_SCRIPTS"]) / "addons/blender_mcp.py"
expected_sha256 = "229ee114f0504b486bdd24bbc8b08fa9b22112f5e831ef8b2e9cc507e9ccbbfe"
if hashlib.sha256(addon_file.read_bytes()).hexdigest() != expected_sha256:
    raise RuntimeError("MCP addon differs from the pinned mcp-for-blender 2.2.2 bundle")
if bpy.app.background:
    raise RuntimeError("This bootstrap requires Blender GUI")
bpy.context.preferences.use_preferences_save = False
addon_utils.enable("blender_mcp", default_set=False, persistent=True)
preferences = bpy.context.preferences.addons.get("blender_mcp")
if preferences:
    preferences.preferences.telemetry_consent = False
print("Pinned Blender MCP addon enabled; awaiting its automatic loopback listener.", flush=True)
