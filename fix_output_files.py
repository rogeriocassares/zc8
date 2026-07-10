#!/usr/bin/env python3
"""Fix corrupted output service main.go files by extracting valid content."""
import os

files = [
    'services/output/influxdb3-writer/cmd/influxdb3-writer/main.go',
    'services/output/mqtt-publisher/cmd/mqtt-publisher/main.go',
    'services/output/http-client/cmd/http-client/main.go',
    'services/output/grpc-client/cmd/grpc-client/main.go',
]

base_dir = '/Users/rogeriocassares/Git/rogeriocassares/zc8'

for rel_path in files:
    path = os.path.join(base_dir, rel_path)
    with open(path, 'r') as f:
        content = f.read()
    
    lines = content.split('\n')
    
    # Find "package main" line
    start_idx = 0
    for i, line in enumerate(lines):
        if line == 'package main':
            start_idx = i
            break
    
    # Find the last valid "var _ integration.Adapter" or "var _ =" line
    end_idx = start_idx
    for i in range(start_idx, len(lines)):
        line = lines[i]
        # Check if line contains the interface compliance check
        if 'var _ integration.Adapter' in line or 'var _ =' in line:
            # The line might have garbage appended after the valid statement
            # Extract just the valid part (up to the closing paren + "nil)")
            if 'var _ integration.Adapter' in line:
                pos = line.find('var _ integration.Adapter')
                # Find the end: "var _ integration.Adapter = (*typeName)(nil)"
                nil_pos = line.find('(nil)', pos)
                if nil_pos >= 0:
                    lines[i] = line[pos:nil_pos+5]
                end_idx = i
            break
    
    valid_lines = lines[start_idx:end_idx+1]
    valid_content = '\n'.join(valid_lines) + '\n'
    
    with open(path, 'w') as f:
        f.write(valid_content)
    
    print(f'{rel_path}: {len(valid_lines)} lines, {os.path.getsize(path)} bytes')
    print(f'  First: {valid_lines[0]}')
    print(f'  Last:  {valid_lines[-1]}')
