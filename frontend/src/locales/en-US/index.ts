/**
 * en-US 词条总入口。`typeof zhCN` 使缺键/多键都成为编译错误，
 * 强制两棵词条树保持同构——改任一 locale 后跑 vue-tsc 即可发现失配。
 */
import type zhCN from '../zh-CN';
import common from './common';
import home from './home';
import log from './log';
import map from './map';
import settings from './settings';
import analysis from './analysis';
import agent from './agent';
import flightMetrics from './flightMetrics';
import fields from './fields';
import curves from './curves';
import customModels from './customModels';
import tilesets from './tilesets';
import scene3d from './scene3d';
import profiles from './profiles';

const enUS: typeof zhCN = { common, home, log, map, settings, analysis, agent, flightMetrics, fields, curves, customModels, tilesets, scene3d, profiles };

export default enUS;
