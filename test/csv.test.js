import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv } from '../server/csv.js';

test('CSV parser accepts legacy and common column names and quoted newlines', () => {
  const rows = parseCsv('group_name,URL,post\r\n"Group, One",https://facebook.com/groups/1,"Hello, world\nagain"');
  assert.deepEqual(rows, [{ groupName: 'Group, One', groupUrl: 'https://facebook.com/groups/1', postText: 'Hello, world\nagain' }]);
});
