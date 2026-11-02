import { describe, test, expect } from "vitest";
import { WORLD } from "../../design/config";
import { Chunk, setBlock as chunkSetBlock } from "../../src/world/Chunk";
import { meshChunk } from "../../src/mesh/naiveMesher";
import { BLOCKS, BLOCK_FACES } from "../../src/world/blocks";

const SIZE = WORLD.CHUNK_SIZE;

describe("naive culled mesher", () => {
  test("all-air chunk emits zero triangles and zero vertices", () => {
    const c = new Chunk({ cx: 0, cy: 0, cz: 0 });
    const m = meshChunk(c, {});
    expect(m.triangleCount).toBe(0);
    expect(m.positions.length).toBe(0);
    expect(m.indices.length).toBe(0);
    expect(m.normals.length).toBe(0);
    expect(m.uvs.length).toBe(0);
    expect(m.blockIds.length).toBe(0);
    expect(m.layer.length).toBe(0);
  });

  test("single solid block at local (0,0,0) with no neighbors emits 6 faces / 12 triangles", () => {
    const c = new Chunk({ cx: 0, cy: 0, cz: 0 });
    chunkSetBlock(c, 0, 0, 0, BLOCKS.grass);
    const m = meshChunk(c, {});
    expect(m.triangleCount).toBe(12);
    expect(m.indices.length).toBe(36); // 6 faces * 2 tris * 3
    // 4 vertices per face * 6 faces = 24 verts
    expect(m.positions.length).toBe(24 * 3);
    expect(m.normals.length).toBe(24 * 3);
    expect(m.uvs.length).toBe(24 * 2);
    expect(m.blockIds.length).toBe(24);
    // Every blockId byte should equal the grass id.
    for (let i = 0; i < m.blockIds.length; i++) {
      expect(m.blockIds[i]).toBe(BLOCKS.grass);
    }
  });

  test("vertex positions are in world space (chunk coord offset applied)", () => {
    const c = new Chunk({ cx: 2, cy: 0, cz: -1 });
    chunkSetBlock(c, 0, 0, 0, BLOCKS.grass);
    const m = meshChunk(c, {});
    // chunk origin in world space
    const ox = 2 * SIZE, oy = 0, oz = -1 * SIZE;
    // scan all vertex x's: minX should be ox, maxX should be ox + 1 (unit cube).
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < m.positions.length; i += 3) {
      minX = Math.min(minX, m.positions[i]);
      maxX = Math.max(maxX, m.positions[i]);
      minY = Math.min(minY, m.positions[i + 1]);
      maxY = Math.max(maxY, m.positions[i + 1]);
      minZ = Math.min(minZ, m.positions[i + 2]);
      maxZ = Math.max(maxZ, m.positions[i + 2]);
    }
    expect(minX).toBe(ox);
    expect(maxX).toBe(ox + 1);
    expect(minY).toBe(oy);
    expect(maxY).toBe(oy + 1);
    expect(minZ).toBe(oz);
    expect(maxZ).toBe(oz + 1);
  });

  test("UV buffer length equals (positions.length / 3) * 2", () => {
    const c = new Chunk({ cx: 0, cy: 0, cz: 0 });
    chunkSetBlock(c, 0, 0, 0, BLOCKS.grass);
    const m = meshChunk(c, {});
    expect(m.uvs.length).toBe((m.positions.length / 3) * 2);
    // 4 vertices per face => 8 uvs per face. 6 faces => 48 uvs.
    expect(m.uvs.length).toBe(48);
  });

  test("adjacent solid voxels hide the shared face", () => {
    const c = new Chunk({ cx: 0, cy: 0, cz: 0 });
    chunkSetBlock(c, 0, 0, 0, BLOCKS.grass);
    chunkSetBlock(c, 1, 0, 0, BLOCKS.grass);
    const m = meshChunk(c, {});
    // Each cube would produce 6; shared face hidden on both sides -> 6+6-2 = 10 faces.
    expect(m.triangleCount).toBe(10 * 2);
  });

  test("exposes a per-vertex `layer` attribute whose length matches vertex count", () => {
    const c = new Chunk({ cx: 0, cy: 0, cz: 0 });
    chunkSetBlock(c, 0, 0, 0, BLOCKS.grass);
    const m = meshChunk(c, {});
    const vertexCount = m.positions.length / 3;
    expect(m.layer).toBeInstanceOf(Uint8Array);
    expect(m.layer.length).toBe(vertexCount);
  });

  test("grass block's layer bytes follow BLOCK_FACES: top=0, sides=1, bottom=2", () => {
    const c = new Chunk({ cx: 0, cy: 0, cz: 0 });
    chunkSetBlock(c, 0, 0, 0, BLOCKS.grass);
    const m = meshChunk(c, {});
    // Face emission order in the mesher is: top, bottom, +x, -x, +z, -z.
    // Each face writes 4 vertices with the same layer byte.
    const faceLayers: number[] = [];
    for (let f = 0; f < 6; f++) {
      faceLayers.push(m.layer[f * 4]);
      // All four verts in a face share the layer index.
      for (let i = 0; i < 4; i++) {
        expect(m.layer[f * 4 + i]).toBe(faceLayers[f]);
      }
    }
    const g = BLOCK_FACES[BLOCKS.grass];
    expect(faceLayers[0]).toBe(g.top);    // 0
    expect(faceLayers[1]).toBe(g.bottom); // 2
    expect(faceLayers[2]).toBe(g.east);   // 1
    expect(faceLayers[3]).toBe(g.west);   // 1
    expect(faceLayers[4]).toBe(g.south);  // 1
    expect(faceLayers[5]).toBe(g.north);  // 1
  });

  test("stone block's layer bytes are 3 on every face (uniform block)", () => {
    const c = new Chunk({ cx: 0, cy: 0, cz: 0 });
    chunkSetBlock(c, 0, 0, 0, BLOCKS.stone);
    const m = meshChunk(c, {});
    for (let i = 0; i < m.layer.length; i++) {
      expect(m.layer[i]).toBe(BLOCK_FACES[BLOCKS.stone].top);
    }
  });

  test("boundary face is culled when a neighbor chunk provides a solid voxel across it", () => {
    const self = new Chunk({ cx: 0, cy: 0, cz: 0 });
    chunkSetBlock(self, SIZE - 1, 0, 0, BLOCKS.grass);
    const px = new Chunk({ cx: 1, cy: 0, cz: 0 });
    // The +x neighbor's local (0,0,0) is adjacent to self's (SIZE-1,0,0).
    chunkSetBlock(px, 0, 0, 0, BLOCKS.grass);
    const mWithNeighbor = meshChunk(self, { px });
    const mNoNeighbor = meshChunk(self, {});
    expect(mNoNeighbor.triangleCount).toBe(12); // all 6 faces
    expect(mWithNeighbor.triangleCount).toBe(10); // +x face culled -> 5 faces
  });

  test("reference 16x16x16 solid-grass chunk reports expected top-only count when neighbors are solid", () => {
    const self = new Chunk({ cx: 0, cy: 0, cz: 0 });
    for (let y = 0; y < SIZE; y++)
      for (let z = 0; z < SIZE; z++)
        for (let x = 0; x < SIZE; x++) chunkSetBlock(self, x, y, z, BLOCKS.grass);

    // Six solid neighbors so only internal faces (which are all hidden) can emit nothing.
    const mk = () => {
      const c = new Chunk({ cx: 0, cy: 0, cz: 0 });
      for (let y = 0; y < SIZE; y++)
        for (let z = 0; z < SIZE; z++)
          for (let x = 0; x < SIZE; x++) chunkSetBlock(c, x, y, z, BLOCKS.grass);
      return c;
    };
    const m = meshChunk(self, { px: mk(), nx: mk(), py: mk(), ny: mk(), pz: mk(), nz: mk() });
    expect(m.triangleCount).toBe(0);

    // And with NO neighbors: only the six outer faces of the 16-cube get emitted.
    // Outer surface is 6 * 16 * 16 = 1536 faces -> 3072 triangles.
    const mNoNeighbors = meshChunk(self, {});
    expect(mNoNeighbors.triangleCount).toBe(6 * SIZE * SIZE * 2);
  });
});
