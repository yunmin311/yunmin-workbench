export function composeDispatchInput(instruction: string, frozenPacket: string): string {
  return ['# Instruction', instruction.trim(), '', '# Frozen Packet', frozenPacket].join('\n');
}
