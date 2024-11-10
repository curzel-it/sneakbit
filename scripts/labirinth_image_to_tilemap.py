import sys
from PIL import Image
import numpy as np

def image_to_matrix(image_path, N, M):
    try:
        # Open the image
        img = Image.open(image_path)
        img = img.resize((M, N))  # Resize the image to match the NxM dimensions
        img = img.convert("RGB")  # Ensure the image is in RGB mode

        # Create an empty matrix
        matrix = np.zeros((N, M), dtype=int)

        # Iterate over each pixel in the image
        for i in range(N):
            for j in range(M):
                r, g, b = img.getpixel((j, i))
                
                # Check if the pixel is white
                if (r, g, b) == (255, 255, 255):
                    matrix[i, j] = 8  # Free cell
                else:
                    matrix[i, j] = 0  # Wall

        return matrix

    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) != 4:
        print("Usage: python script.py <image_path> <N> <M>")
        sys.exit(1)

    image_path = sys.argv[1]
    N = int(sys.argv[2])
    M = int(sys.argv[3])

    matrix = image_to_matrix(image_path, N, M)

    print("Generated Matrix:")
    for i in range(10):
        print('"' + "8" * (len(matrix[0]) + 20) + '",')

    for row in matrix:
        content = "".join(map(str, row))
        content = "8888888888" + content
        content = content + "8888888888" 
        content = '"' + content + '",'
        print(content)

    for i in range(10):
        print('"' + "8" * (len(matrix[0]) + 20) + '",')

    #for i in range(10 + len(matrix) + 20):
    #    print('"' + "A" * (len(matrix[0]) + 20) + '",')