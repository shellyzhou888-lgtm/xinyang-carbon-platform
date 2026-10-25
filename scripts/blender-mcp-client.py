"""Call the pinned upstream Blender MCP through the official MCP stdio SDK.

This is a client, never a direct Blender socket or offline bpy runner. Scene code
is sent exclusively to execute_blender_code; installation bootstrap is separate.
Run with: uv run --python 3.11 --with "mcp<2" python scripts/blender-mcp-client.py ...
"""
import argparse
import asyncio
import base64
import json
import os
from datetime import datetime, timezone
from pathlib import Path

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

ROOT = Path(__file__).resolve().parents[1]
USER_PROMPT = "我觉得可以，你可以开始建模，色调需要统一"


async def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--uvx", default="uvx")
    parser.add_argument("--tool", default="execute_blender_code")
    parser.add_argument("--code", type=Path)
    parser.add_argument("--library", type=Path)
    parser.add_argument("--define", default="{}", help="JSON constants prepended to the tool source")
    parser.add_argument("--arguments", default="{}")
    parser.add_argument("--label", required=True)
    parser.add_argument("--output-dir", type=Path, default=ROOT / "assets/blender-models/v1")
    parser.add_argument("--audit-dir", type=Path, default=ROOT / "storage/tooling/blender-mcp/audit")
    parser.add_argument("--user-prompt", default=USER_PROMPT)
    parser.add_argument("--data", type=Path, help="JSON scene specification passed as the LAYOUT constant")
    parser.add_argument("--image-output", type=Path, help="Save the first image returned by an MCP tool")
    opts = parser.parse_args()
    params = StdioServerParameters(
        command=opts.uvx,
        args=["--python", "3.11", "mcp-for-blender==2.2.2"],
        env={**os.environ, "DISABLE_TELEMETRY": "true", "BLENDER_HOST": "127.0.0.1",
             "BLENDER_PORT": "9876", "BLENDER_MCP_SAFE_MODE": "true"},
    )
    arguments = json.loads(opts.arguments)
    if opts.code:
        prefix = opts.library.read_text(encoding="utf-8") + "\n" if opts.library else ""
        prefix += f"OUT = {opts.output_dir.resolve().as_posix() + '/'!r}\n"
        if opts.data:
            prefix += f"LAYOUT = {json.loads(opts.data.read_text(encoding='utf-8'))!r}\n"
        for name, value in json.loads(opts.define).items():
            if not name.isidentifier() or name.startswith('_'):
                raise ValueError("Invalid constant name")
            prefix += f"{name} = {value!r}\n"
        arguments = {"code": prefix + opts.code.read_text(encoding="utf-8"), "user_prompt": opts.user_prompt}
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            initialized = await session.initialize()
            listed = await session.list_tools()
            tools = [tool.name for tool in listed.tools]
            server_info = initialized.model_dump(by_alias=True)["serverInfo"]
            print(json.dumps({"server": server_info, "tools": tools}, ensure_ascii=False))
            if opts.tool not in tools:
                raise RuntimeError(f"MCP server does not expose {opts.tool}")
            result = await session.call_tool(opts.tool, arguments=arguments)
            record = {
                "at": datetime.now(timezone.utc).isoformat(),
                "transport": "MCP stdio / official Python SDK ClientSession",
                "server": server_info,
                "package": "mcp-for-blender==2.2.2", "tool": opts.tool,
                "arguments": arguments, "result": result.model_dump(mode="json"),
            }
            audit_dir = opts.audit_dir
            audit_dir.mkdir(parents=True, exist_ok=True)
            (audit_dir / f"{opts.label}.json").write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
            texts = [block.text for block in result.content if block.type == "text"]
            if opts.image_output:
                images = [block for block in result.content if block.type == "image"]
                if not images:
                    raise RuntimeError("MCP tool returned no image; inspect the audit result")
                opts.image_output.parent.mkdir(parents=True, exist_ok=True)
                opts.image_output.write_bytes(base64.b64decode(images[0].data, validate=True))
                print(f"MCP image saved: {opts.image_output}")
            for value in texts:
                print(value[:14000])
            if result.model_dump(by_alias=True).get("isError") or any(value.startswith(("Error", "Rejected")) for value in texts):
                raise RuntimeError("MCP tool failed; inspect the audit result")


if __name__ == "__main__":
    asyncio.run(main())
