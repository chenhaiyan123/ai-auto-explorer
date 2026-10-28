import assert from 'node:assert/strict';
import { NodeStatus, type Project } from '../types';
import { profileDue, parseProfile, buildProfileMessages, profileToListing, profileSkills } from '../services/pmProfile';

const DAY = 86400000;
const node = (i: number, status = NodeStatus.SOLVED) => ({ id: `n${i}`, title: `步骤${i}`, status, confidence: 0.5, dependencies: [], notes: `结论${i}` });
const proj = (solved: number, extra: Partial<Project> = {}) => ({ id: 'p', name: '宠物食品', metaProblem: '找到宠物食品的细分机会', nodes: [...Array(solved)].map((_, i) => node(i)).concat([node(99, NodeStatus.UNEXPLORED)]), ...extra }) as unknown as Project;

assert.equal(profileDue(proj(2)), false, '做完不到 3 步不写');
assert.equal(profileDue(proj(3)), true);
const pr = parseProfile(JSON.stringify({ title: '宠物食品市场调研 · AI 项目经理', summary: '我调研过国内宠物食品的细分赛道和用户痛点。', canDo: ['竞品清单', '用户访谈提纲'], edge: ['整理过 40 个品牌'], needs: ['找宠物店主聊'], priceYuan: 80, deliveryDays: 3 }), 3, Date.now() - 2 * DAY)!;
assert.ok(pr); assert.equal(pr.priceYuan, 80); assert.equal(pr.basis, 3);
assert.equal(parseProfile('{"title":"x"}', 3), null, '缺字段不收');
assert.equal(parseProfile('not json', 3), null);
assert.equal(parseProfile(JSON.stringify({ title: '宠物食品调研服务', summary: '一段足够长的简介文字在这里', canDo: ['a'], priceYuan: 999999 }), 3)!.priceYuan, 50, '离谱价格回落');
// 有草稿后：又多做完 3 步、隔了一天才更新
assert.equal(profileDue(proj(4, { pmProfile: { draft: pr } })), false);
assert.equal(profileDue(proj(6, { pmProfile: { draft: pr } })), true);
assert.equal(profileDue(proj(6, { pmProfile: { draft: { ...pr, updatedAt: Date.now() } } })), false, '一天内不重复写');
const msgs = buildProfileMessages(proj(3, { pmProfile: { published: pr } }));
assert.match(msgs[1].content, /上一版简介/); assert.match(msgs[1].content, /步骤0/);
const l = profileToListing(pr, { serviceId: 's1', serviceRevision: 2 }, 'AI 项目经理 · 宠物食品');
assert.equal(l.id, 's1'); assert.equal(l.revision, 2); assert.equal(l.priceCents, 8000); assert.equal(l.automation, 'automatic'); assert.equal(l.confirmed, true);
assert.match(l.description, /纯 AI 完成/);
assert.equal(profileToListing(pr, undefined, 'x').revision, 0);
assert.match(profileSkills(proj(3, { pmProfile: { published: pr } })), /竞品清单/);
console.log('pm-profile ok');
