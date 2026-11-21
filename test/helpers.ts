import * as path from 'path';

/** Fixtures live in the source tree; compiled tests run from out/test. */
export const FIXTURES = path.resolve(__dirname, '..', '..', 'test', 'fixtures');
export const PROJECTS = path.join(FIXTURES, 'projects');
export const SESSION_A = path.join(PROJECTS, '-home-user-gateway-agent', '11111111-aaaa-4bbb-8ccc-000000000001.jsonl');
export const SESSION_B = path.join(PROJECTS, '-home-user-remote-workspace', '22222222-aaaa-4bbb-8ccc-000000000002.jsonl');
