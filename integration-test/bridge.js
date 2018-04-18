import rimraf from 'rimraf';
import path from 'path';
import chai from 'chai';
import logger from 'winston';
import { LiquidPledgingState } from 'giveth-liquidpledging';
import deploy from './helpers/deploy';
import config from '../src/configuration';
import { testBridge } from '../src/bridge';

const assert = chai.assert;

// process.on('unhandledRejection', (reason, p) => {
//   console.log('Unhandled Rejection at: Promise', p, 'reason:', reason);
//   // application specific logging, throwing an error, or other logic here
// });

const printState = async (lpState) => {
  console.log(JSON.stringify(await lpState.getState(), null, 2));
}

const runBridge = (bridge, logLevel = 'none') => {
  logger.level = logLevel;

  return bridge.relayer.poll()
    .then(() => bridge.verifyer.verify())
}

const extendWeb3 = (web3) => {
  web3.extend({
    property: 'eth',
    methods: [
      {
        name: 'snapshot',
        call: 'evm_snapshot',
      },
      {
        name: 'revertToSnapshot',
        call: 'evm_revert',
        params: 1,
      }
    ]
  });
}

describe('Bridge Integration Tests', function () {
  this.timeout(0);

  let deployData;
  let liquidPledging;
  let liquidPledgingState;
  let vault;
  let foreignBridge;
  let homeBridge;
  let homeWeb3;
  let foreignWeb3;
  let bridge;
  let foreignEth;
  let project1Admin;
  let project1;
  let giver1;
  let snapshotId;

  before(async () => {
    rimraf.sync(path.join(__dirname, 'data/*.db'), {}, console.log);

    deployData = await deploy();
    liquidPledging = deployData.liquidPledging;
    liquidPledgingState = new LiquidPledgingState(liquidPledging);
    vault = deployData.vault;
    foreignBridge = deployData.foreignBridge;
    homeBridge = deployData.homeBridge;
    homeWeb3 = deployData.homeWeb3;
    foreignWeb3 = deployData.foreignWeb3;
    foreignEth = deployData.foreignEth;

    extendWeb3(homeWeb3);
    extendWeb3(foreignWeb3);

    project1Admin = deployData.foreignAccounts[4];
    giver1 = deployData.homeAccounts[3];
    await liquidPledging.addProject('Project1', '', project1Admin, 0, 0, 0, { from: project1Admin, $extraGas: 100000 });
    project1 = 1; // admin 1

    bridge = testBridge();
  });

  beforeEach(async function () {
    // bug in ganache-cli prevents rolling back to same snapshot multiple times
    // https://github.com/trufflesuite/ganache-core/issues/104
    snapshotId = await foreignWeb3.eth.snapshot();
    await homeWeb3.eth.snapshot();
  });

  afterEach(async function () {
    await foreignWeb3.eth.revertToSnapshot(snapshotId);
    await homeWeb3.eth.revertToSnapshot(snapshotId);
  })

  after(async () => {
    if (deployData) {
      deployData.homeNetwork.close();
      deployData.foreignNetwork.close();
    }
    // web3 prevents closing ganache. I believe due to listeners it attaches
    setTimeout(() => process.exit(0), 1000)
  });

  it('Should bridge donateAndCreateGiver', async function () {
    await homeBridge.donateAndCreateGiver(giver1, project1, 0, 1000, { from: giver1, value: 1000 });

    await runBridge(bridge);

    const homeBal = await homeWeb3.eth.getBalance(homeBridge.$address);
    assert.equal(homeBal, 1000);

    const vaultBal = await foreignEth.balanceOf(vault.$address);
    assert.equal(vaultBal, 1000);

    const p = await liquidPledging.getPledge(2);
    assert.equal(p.amount, 1000);
    assert.equal(p.token, foreignEth.$address);
    assert.equal(p.owner, project1);
  });

  it('Should bridge donate', async function () {
    await liquidPledging.addGiver('Giver1', '', 0, 0, { from: giver1, $extraGas: 100000 }); // admin 2
    await homeBridge.donate(2, project1, 0, 1000, { from: giver1, value: 1000 });

    await runBridge(bridge);

    const homeBal = await homeWeb3.eth.getBalance(homeBridge.$address);
    assert.equal(homeBal, 1000);

    const vaultBal = await foreignEth.balanceOf(vault.$address);
    assert.equal(vaultBal, 1000);

    const p = await liquidPledging.getPledge(2);
    assert.equal(p.amount, 1000);
    assert.equal(p.token, foreignEth.$address);
    assert.equal(p.owner, project1);
  });
});