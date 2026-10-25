// Unit tests (vitest setupFiles): the shipped demo project is active before engine modules are imported. A test of another
// project activates it itself: withProject(readProjectDir(...), fn) or activateProject(...) in beforeAll.
import path from 'node:path';
import { activateProject } from '../project/active';
import { buildProjectIndex, readProjectDir } from '../project/node';
import { setProjectIndex } from '../project/registry';

const root = path.resolve(__dirname, '..', '..');
setProjectIndex(buildProjectIndex(root));
activateProject(readProjectDir(path.join(root, 'projects', 'demo-apartment')));

/** directory of a test fixture project (src/test/fixtures/<name>/project.json) */
export const fixtureDir = (name: string) => path.join(root, 'src', 'test', 'fixtures', name);
