# Open in its own MCP call so Blender completes its UI/context reset before edits.
import bpy
bpy.ops.wm.open_mainfile(filepath=FILE)
print('Opened saved project through Blender MCP; subsequent operations use a new tool call.')
