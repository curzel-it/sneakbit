import os
import json
import networkx as nx
import matplotlib.pyplot as plt

def main():
    path = 'data'

    # Get all JSON files in the current directory
    json_files = [f for f in os.listdir(path) if f.endswith('.json')]
    G = nx.DiGraph()

    # Iterate over each JSON file
    for filename in json_files:
        try:
            name_world_id = int(filename.replace(".json", ""))
        except:
            continue

        filepath = f'{path}/{filename}'

        with open(filepath, 'r') as f:
            data = json.load(f)
            world_id = data.get('id')

            if name_world_id != world_id:
                print(f"Wrong file name! {name_world_id} vs {world_id}")
                break

            G.add_node(world_id)
            entities = data.get('entities', [])

            for entity in entities:
                destination = entity.get('destination', {}) or {}
                dest_world_id = destination.get('world')
                if dest_world_id is not None:
                    G.add_edge(world_id, dest_world_id)

    # Draw the graph
    pos = nx.spring_layout(G)
    nx.draw(G, pos, with_labels=True, node_size=700, node_color='lightgreen', arrowsize=20)
    plt.title('World Connections Graph')
    plt.show()

if __name__ == '__main__':
    main()
