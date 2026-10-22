render(ZONE,VIEW,width=1600,height=1100)
print(json.dumps({'zone':ZONE,'view':VIEW,'projection':bpy.context.scene.camera.data.type,'file':bpy.context.scene.render.filepath}))
