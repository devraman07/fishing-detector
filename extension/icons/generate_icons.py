#!/usr/bin/env python3
"""
Generate placeholder PNG icons for Chrome Extension
"""

def create_png(width, height, color):
    """Create a minimal valid PNG file with solid color"""
    import struct
    import zlib
    
    def png_chunk(chunk_type, data):
        chunk = chunk_type + data
        crc = zlib.crc32(chunk) & 0xffffffff
        return struct.pack('>I', len(data)) + chunk + struct.pack('>I', crc)
    
    # PNG signature
    signature = b'\x89PNG\r\n\x1a\n'
    
    # IHDR chunk
    ihdr_data = struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)  # 8-bit RGB
    ihdr = png_chunk(b'IHDR', ihdr_data)
    
    # IDAT chunk (compressed image data)
    raw_data = b''
    r, g, b = color
    for _ in range(height):
        raw_data += b'\x00'  # Filter byte (no filter)
        for _ in range(width):
            raw_data += bytes([r, g, b])
    
    compressed = zlib.compress(raw_data)
    idat = png_chunk(b'IDAT', compressed)
    
    # IEND chunk
    iend = png_chunk(b'IEND', b'')
    
    return signature + ihdr + idat + iend

# Generate icons with different sizes and colors
icons = [
    (16, 16, (46, 213, 115), 'icon16.png'),   # Green
    (32, 32, (46, 213, 115), 'icon32.png'),   # Green
    (48, 48, (46, 213, 115), 'icon48.png'),   # Green
    (128, 128, (46, 213, 115), 'icon128.png') # Green
]

for width, height, color, filename in icons:
    png_data = create_png(width, height, color)
    with open(filename, 'wb') as f:
        f.write(png_data)
    print(f"Created {filename} ({width}x{height})")

print("All icons generated successfully!")
