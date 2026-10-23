const { test } = require('node:test');
const assert = require('node:assert/strict');
require('dotenv').config();
const { prisma } = require('../dist/config/db.js');
const { menuRepository: menus } = require('../dist/modules/menu/menus/menu.repository.js');
const { menuItemRepository: items } = require('../dist/modules/menu/menu-items/menu-item.repository.js');
const { menuAccessRepository: accesses } = require('../dist/modules/menu/menu-accesses/menu-access.repository.js');

test('Menu deletion preserves rows, blocks dependencies and prevents deleted records from being updated', async t => {
  const menu = { id: 'menu', isDeleted: false, isActive: true, hasItem: true };
  const item = { id: 'item', menuId: menu.id, isDeleted: false, isActive: true };
  const access = { id: 'access', menuItemId: item.id, isDeleted: false };
  const original = prisma.$transaction;
  const update = row => async ({ data }) => Object.assign(row, data);
  const tx = {
    $executeRaw: async () => 1,
    $queryRaw: async () => [{ id: menu.id }],
    menu: { findUnique: async () => menu, findUniqueOrThrow: async () => menu,
      findFirst: async () => menu.isDeleted ? null : menu, update: update(menu) },
    menuItem: { findUnique: async () => item, findFirst: async () => item.isDeleted ? null : item,
      count: async () => Number(!item.isDeleted), update: update(item) },
    menuAccess: { findUnique: async () => access, count: async () => Number(!access.isDeleted), update: update(access) },
  };
  prisma.$transaction = async action => action(tx);
  t.after(() => { prisma.$transaction = original; });
  const conflict = action => assert.rejects(action, error => error.statusCode === 409);
  await conflict(() => menus.delete(menu.id));
  await conflict(() => items.delete(item.id));
  assert.equal(menu.isDeleted, false);
  assert.equal(item.isDeleted, false);
  assert.equal((await accesses.delete(access.id)).isDeleted, true);
  await conflict(() => accesses.delete(access.id));
  await conflict(() => accesses.update(access.id, { role: 'ADMIN' }));
  assert.equal((await items.delete(item.id)).isDeleted, true);
  assert.equal(item.isActive, false);
  await conflict(() => items.delete(item.id));
  await conflict(() => items.update(item.id, { isActive: true }));
  assert.equal((await menus.delete(menu.id)).isDeleted, true);
  assert.equal(menu.isActive, false);
  await conflict(() => menus.delete(menu.id));
  await conflict(() => menus.update(menu.id, { isActive: true }));
  await assert.rejects(() => items.create({ menuId: menu.id, key: 'new', label: 'New', order: 0 }), e => e.statusCode === 404);
  await assert.rejects(() => accesses.create({ menuItemId: item.id, role: null, section: null }), e => e.statusCode === 404);
});

test('Unknown menu records return 404 without a mutation', async t => {
  const original = prisma.$transaction;
  const missing = { findUnique: async () => null };
  prisma.$transaction = async action => action({ $executeRaw: async () => 1, menu: missing, menuItem: missing, menuAccess: missing });
  t.after(() => { prisma.$transaction = original; });
  for (const repository of [menus, items, accesses]) {
    await assert.rejects(() => repository.delete('missing'), e => e.statusCode === 404);
  }
});

test('Deleted access rules cannot grant user menu permissions', async t => {
  const original = prisma.menuItem.findMany;
  const rule = { role: 'ADMIN', section: 'MARKETING', isDeleted: false };
  const row = { key: 'orders', label: 'Orders', order: 0, isActive: true, isDeleted: false,
    menu: { id: 'menu', key: 'marketing', label: 'Marketing', order: 0, hasItem: true, isActive: true, isDeleted: false }, accesses: [rule] };
  // Evaluate the repository's permission predicate against retained rows so a
  // missing deletion filter would expose the menu after its rule was deleted.
  const matches = (value, where) => Object.entries(where).every(([key, condition]) => {
    if (key === 'AND') return condition.every(part => matches(value, part));
    if (key === 'OR') return condition.some(part => matches(value, part));
    if (condition && typeof condition === 'object') {
      if ('some' in condition) return value[key].some(child => matches(child, condition.some));
      return matches(value[key], condition);
    }
    return value[key] === condition;
  });
  prisma.menuItem.findMany = async ({ where }) => matches(row, where) ? [row] : [];
  t.after(() => { prisma.menuItem.findMany = original; });
  assert.equal((await menus.findMenusForUser('ADMIN', 'MARKETING')).length, 1);
  rule.isDeleted = true;
  assert.deepEqual(await menus.findMenusForUser('ADMIN', 'MARKETING'), []);
  rule.isDeleted = false;
  row.isDeleted = true;
  assert.deepEqual(await menus.findMenusForUser('ADMIN', 'MARKETING'), []);
  row.isDeleted = false;
  row.menu.isDeleted = true;
  assert.deepEqual(await menus.findMenusForUser('ADMIN', 'MARKETING'), []);
});
