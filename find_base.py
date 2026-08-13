import json

log_path = r'C:\Users\Antec\.gemini\antigravity-ide\brain\416b9385-3f1a-4c03-ae3e-a081eb236615\.system_generated\logs\transcript_full.jsonl'

with open(log_path, 'r', encoding='utf-8') as f:
    for line in f:
        if 'base.html' in line:
            obj = json.loads(line)
            step = obj.get('step_index')
            for c in obj.get('tool_calls', []):
                args = c.get('args', {})
                tf = args.get('TargetFile', '')
                if tf.endswith('base.html') and not tf.endswith('admin_base.html'):
                    code = args.get('CodeContent') or args.get('ReplacementContent') or ''
                    print(f"Step {step}: tool={c.get('name')}, code_len={len(code)}")
                    if c.get('name') == 'write_to_file' and step == 34:
                        print("Step 34 Code Preview:")
                        print(code[:300])
