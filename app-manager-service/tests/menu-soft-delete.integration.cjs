const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
require('dotenv').config();
const { prisma } = require('../dist/config/db.js');
const { menuRepository: menus } = require('../dist/modules/menu/menus/menu.repository.js');
const { menuItemRepository: items } = require('../dist/modules/menu/menu-items/menu-item.repository.js');
const { menuAccessRepository: accesses } = require('../dist/modules/menu/menu-accesses/menu-access.repository.js');

test('PostgreSQL serializes child creation against parent soft deletion and retains deleted rows', async () => {
  const prefix = `delete_test_${randomUUID()}`;
  let menuId;
  try {
    const menu = await menus.create({ key: prefix, label: 'Delete test', hasItem: true, order: 0 });
    menuId = menu.id;
    const [creation, deletion] = await Promise.allSettled([
      items.create({ key: `${prefix}_item`, menuId, label: 'Delete test item', order: 0 }),
      menus.delete(menuId),
    ]);
    assert.equal([creation, deletion].filter(result => result.status === 'fulfilled').length, 1,
      'a child must never be created under a deleted parent');
    if (creation.status === 'fulfilled') {
      assert.equal(deletion.reason.statusCode, 409);
      const item = creation.value;
      const rule = await accesses.create({ menuItemId: item.id, role: 'ADMIN', section: 'MARKETING' });
      await assert.rejects(() => items.delete(item.id), error => error.statusCode === 409);
      await accesses.delete(rule.id);
      assert.equal((await prisma.menuAccess.findUniqueOrThrow({ where: { id: rule.id } })).isDeleted, true);
      const visible = await menus.findMenusForUser('ADMIN', 'MARKETING');
      assert.equal(visible.some(row => row.key === prefix), false, 'a deleted rule cannot grant access');
      await items.delete(item.id);
      assert.equal((await prisma.menuItem.findUniqueOrThrow({ where: { id: item.id } })).isDeleted, true);
      await menus.delete(menuId);
    } else {
      assert.equal(creation.reason.statusCode, 404);
    }
    assert.equal((await prisma.menu.findUniqueOrThrow({ where: { id: menuId } })).isDeleted, true);
    assert.equal(await menus.findActiveById(menuId), null);
    await assert.rejects(() => menus.delete(menuId), error => error.statusCode === 409);
  } finally {
    // Only this test's fixture hierarchy is physically removed after assertions.
    if (menuId) await prisma.menu.delete({ where: { id: menuId } });
    await prisma.$disconnect();
  }
});

test('Concurrent nullable access identities cannot be duplicated or reused after deletion', async () => {
  const key = `access_test_${randomUUID()}`;
  let menuId;
  try {
    menuId = (await menus.create({ key, label: 'Access test', hasItem: true, order: 0 })).id;
    const item = await items.create({ key: `${key}_item`, menuId, label: 'Access test item', order: 0 });
    const input = { menuItemId: item.id, role: null, section: null };
    const results = await Promise.allSettled([accesses.create(input), accesses.create(input)]);
    const created = results.filter(result => result.status === 'fulfilled');
    assert.equal(created.length, 1);
    assert.equal(results.find(result => result.status === 'rejected').reason.statusCode, 409);
    await accesses.delete(created[0].value.id);
    await assert.rejects(() => accesses.create(input), error => error.statusCode === 409);
    await items.delete(item.id);
    await menus.delete(menuId);
  } finally {
    if (menuId) await prisma.menu.delete({ where: { id: menuId } });
    await prisma.$disconnect();
  }
});
