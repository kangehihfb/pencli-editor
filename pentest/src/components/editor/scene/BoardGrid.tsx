export function BoardGrid() {
  return (
    <group name="board:grid" position={[0, 0, -0.5]}>
      <gridHelper name="board:grid-helper" args={[20, 20, '#d6deea', '#eef2f7']} rotation={[Math.PI / 2, 0, 0]} />
    </group>
  );
}
