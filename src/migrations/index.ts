import * as migration_20261102_103614_initial_schema from './20261102_103614_initial_schema';

export const migrations = [
  {
    up: migration_20261102_103614_initial_schema.up,
    down: migration_20261102_103614_initial_schema.down,
    name: '20261102_103614_initial_schema'
  },
];
