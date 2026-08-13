import json

log_path = r'C:\Users\Antec\.gemini\antigravity-ide\brain\416b9385-3f1a-4c03-ae3e-a081eb236615\.system_generated\logs\transcript_full.jsonl'
target = r'c:\Users\Antec\Desktop\Coding projects\Events Site\ltrie_app\templates\base.html'

with open(log_path, 'r', encoding='utf-8') as f:
    for line in f:
        if 'base.html' in line:
            obj = json.loads(line)
            step = obj.get('step_index')
            for c in obj.get('tool_calls', []):
                args = c.get('args', {})
                tf = args.get('TargetFile', '')
                if tf.endswith('base.html') and not tf.endswith('admin_base.html'):
                    name = c.get('name')
                    print(f"Replaying Step {step} ({name})...")
                    if name == 'write_to_file':
                        code = args.get('CodeContent', '')
                        with open(target, 'w', encoding='utf-8') as out:
                            out.write(code)
                        print(f"  -> Wrote {len(code)} bytes")
                    elif name == 'replace_file_content':
                        with open(target, 'r', encoding='utf-8') as infile:
                            content = infile.read()
                        tc = args.get('TargetContent', '')
                        rc = args.get('ReplacementContent', '')
                        if tc in content:
                            content = content.replace(tc, rc, 1 if not args.get('AllowMultiple') else -1)
                            with open(target, 'w', encoding='utf-8') as out:
                                out.write(content)
                            print(f"  -> Applied replace_file_content")
                        else:
                            print(f"  -> Target content not found: {tc[:30]}...")
                    elif name == 'multi_replace_file_content':
                        with open(target, 'r', encoding='utf-8') as infile:
                            content = infile.read()
                        chunks = args.get('ReplacementChunks', [])
                        for chunk in chunks:
                            tc = chunk.get('TargetContent', '')
                            rc = chunk.get('ReplacementContent', '')
                            if tc in content:
                                content = content.replace(tc, rc, 1 if not chunk.get('AllowMultiple') else -1)
                            else:
                                print(f"  -> Target chunk not found: {tc[:30]}...")
                        with open(target, 'w', encoding='utf-8') as out:
                            out.write(content)
                        print(f"  -> Applied multi_replace_file_content")

print("Finished restoring base.html.")
