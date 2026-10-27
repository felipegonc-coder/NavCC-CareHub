import { describe, expect, it } from 'vitest';
import { configLines, settingsFrom } from './postgres.mjs';

describe('postgres.mjs', () => {
  it('reads the user, port and database from DATABASE_URL', () => {
    expect(settingsFrom('postgres://carehub@127.0.0.1:55432/carehub')).toEqual({
      user: 'carehub',
      port: 55432,
      database: 'carehub',
    });
    expect(settingsFrom('postgres://127.0.0.1')).toEqual({
      user: 'postgres',
      port: 5432,
      database: 'postgres',
    });
  });

  it('listens on 127.0.0.1 only and keeps the socket in its folder', () => {
    expect(configLines(55432, "/tmp/it's here")).toEqual([
      "listen_addresses = '127.0.0.1'",
      'port = 55432',
      "unix_socket_directories = '/tmp/it''s here'",
      'fsync = off',
      'synchronous_commit = off',
      'full_page_writes = off',
    ]);
  });
});
