import json
import sys


_next_request_id = 1
_pending = {}


def send(message):
    sys.stdout.write(json.dumps(message) + "\n")
    sys.stdout.flush()


def call_tool(tool, args=None):
    global _next_request_id
    request_id = f"req-{_next_request_id}"
    _next_request_id += 1
    send({
        "type": "tool_call",
        "requestId": request_id,
        "tool": tool,
        "args": args or {}
    })

    while True:
      line = sys.stdin.readline()
      if not line:
          raise RuntimeError("Harness closed stdin while waiting for tool result.")
      message = json.loads(line)
      if message.get("requestId") != request_id:
          continue
      if message.get("type") == "tool_error":
          raise RuntimeError(message.get("error", "Unknown tool error"))
      if message.get("type") == "tool_result":
          return message.get("result")


def say(content, channel="assistant"):
    send({
        "type": "message",
        "channel": channel,
        "content": content
    })


def finish(output):
    send({
        "type": "final_output",
        "output": output
    })
    raise SystemExit(0)


def run_task(task):
    prompt = task["prompt"]
    say(f"Received task: {task['id']}")
    finish(f"Replace this template with your real agent logic. Prompt was: {prompt}")


def main():
    for line in sys.stdin:
        if not line.strip():
            continue
        message = json.loads(line)
        if message.get("type") == "run_task":
            run_task(message["task"])
            break


if __name__ == "__main__":
    main()
