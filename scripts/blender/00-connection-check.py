import bpy
import json

print(json.dumps({"blender": bpy.app.version_string, "background": bpy.app.background,
                  "file": bpy.data.filepath, "objects": len(bpy.data.objects),
                  "mcp_running": bpy.context.scene.blendermcp_server_running}, ensure_ascii=False))
