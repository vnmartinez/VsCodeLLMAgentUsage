import { describe, expect, it } from 'vitest';
import { buildPromoteScript } from '../src/promote';

describe('buildPromoteScript', () => {
  it('escapes apostrophes and preserves paths with spaces', () => {
    const script = buildPromoteScript("C:\\Users\\O'Brien\\Agent Usage\\agent.exe");

    expect(script).toContain("$target = 'C:\\Users\\O''Brien\\Agent Usage\\agent.exe';");
  });
});
