/* eslint-disable comma-dangle */

'use strict';

const { OAuth2App } = require('homey-oauth2app');
const { TYPE } = require('./lib/common');
const myUplinkOAuth2Client = require('./lib/myUplinkOAuth2Client');

const DEBUG = false;
const MYUPLINK_DUMP = false;

class myUplinkApp extends OAuth2App {

  static OAUTH2_CLIENT = myUplinkOAuth2Client; // Default: OAuth2Client
  static OAUTH2_DEBUG = DEBUG; // Default: false
  static OAUTH2_MULTI_SESSION = false; // Default: false
  // static OAUTH2_DRIVERS = ['generic']; // Default: all drivers

  /**
   * onInit is called when the app is initialized.
   */
  async onOAuth2Init() {
    if (DEBUG) {
      this.log('myUplink App has been initialized');
    }

    // Register action cards
    const cardActionSetDevicePoint = this.homey.flow.getActionCard('set_devicepoint');
    cardActionSetDevicePoint.registerRunListener(async (args) => {
      return args.device.onSetDevicePoint(args.devicePoint.id, args.newValue.id);
    });
    cardActionSetDevicePoint.registerArgumentAutocompleteListener(
      'devicePoint',
      async (query, args) => {
        return this.generateDevicePointList(query, args, true);
      }
    );
    cardActionSetDevicePoint.registerArgumentAutocompleteListener(
      'newValue',
      async (query, args) => {
        return this.generateDevicePointValueList(query, args);
      }
    );

    const cardActionSetDevicePointNumeric = this.homey.flow.getActionCard('set_devicepoint_numeric');
    cardActionSetDevicePointNumeric.registerRunListener(async (args) => {
      return args.device.onSetDevicePoint(args.devicePoint.id, args.newValue);
    });
    cardActionSetDevicePointNumeric.registerArgumentAutocompleteListener(
      'devicePoint',
      async (query, args) => {
        return this.generateDevicePointList(query, args, true);
      }
    );

    // Register condition cards
    const cardConditionEqualDevicePoint = this.homey.flow.getConditionCard('devicepoint_is');
    cardConditionEqualDevicePoint.registerRunListener(async (args, state) => {
      await args.device.oAuth2Client.qualifyCache(args.device.deviceId, +args.devicePoint.id);
      const value = +args.value.id;
      const stateValue = +args.device.oAuth2Client.confirmedDevicePoints[args.device.deviceId][args.devicePoint.id];
      this.log(`Checking if ${stateValue} ${args.condition} ${value}`);
      const passed = ((args.condition === 'eq') && (value === stateValue))
        || ((args.condition === 'gt') && (stateValue > value))
        || ((args.condition === 'lt') && (stateValue < value));
      return passed;
    });
    cardConditionEqualDevicePoint.registerArgumentAutocompleteListener(
      'devicePoint',
      async (query, args) => {
        return this.generateDevicePointList(query, args, false);
      }
    );
    cardConditionEqualDevicePoint.registerArgumentAutocompleteListener(
      'value',
      async (query, args) => {
        return this.generateDevicePointValueList(query, args);
      }
    );

    // Register trigger cards
    const cardTriggerDevicePointChanged = this.homey.flow.getDeviceTriggerCard('devicepoint_changed');
    cardTriggerDevicePointChanged.registerRunListener(async (args, state) => {
      await args.device.oAuth2Client.qualifyCache(args.device.deviceId, +args.devicePoint.id);
      return Promise.resolve(+state.devicePoint === +args.devicePoint.id);
    });
    cardTriggerDevicePointChanged.registerArgumentAutocompleteListener(
      'devicePoint',
      async (query, args) => {
        return this.generateDevicePointList(query, args, false);
      }
    );
  }

  /**
   * Service dumping to facillitate dumping of the myUplink state (only for debug)
   */
  startDump() {
    if (MYUPLINK_DUMP) {
      this.log('===== START_OF_MYUPLINK_DUMP =====');
    }
    return MYUPLINK_DUMP;
  }

  /**
   * Service dumping to facillitate dumping of the myUplink state (only for debug)
   */
  endDump() {
    if (MYUPLINK_DUMP) {
      this.log('===== END_OF_MYUPLINK_DUMP =====');
    }
    return MYUPLINK_DUMP;
  }

  /**
   * Generates a list of device points that can be set
   */
  async generateDevicePointList(query, args, writableOnly) {
    const devpointMap = args.device.oAuth2Client.devices[args.device.instanceId].deviceDefinition.devPointTable;
    const devPoints = Object.keys(devpointMap);
    const results = [];

    // Reset old parameter as it becomes invalid
    args.newValue = undefined;

    args.device.log(`generate args dev point list: ${JSON.stringify(Object.keys(args))}`);

    for (let i = 0; i < devPoints.length; i++) {
      const id = devPoints[i];
      if (writableOnly && !devpointMap[id].writable) continue;
      const {
        type, minValue, maxValue, scaleValue, parameterUnit, writable
      } = devpointMap[id];
      const name = typeof devpointMap[id].parameterName === 'string' ? devpointMap[id].parameterName : this.homey.__(devpointMap[id].parameterName);
      const newOption = {
        name,
        id: String(id)
      };
      let range;
      switch (type) {
        case TYPE.ENUM:
          newOption.description = `An enum value for parameter ${id}.`;
          break;
        case TYPE.NUMBER:
          range = writable ? `between [${minValue * +scaleValue}, ${maxValue * +scaleValue}]` : 'of type';
          newOption.description = `A numeric value ${range} ${parameterUnit}.`;
          break;
        default:
          continue;
      }
      results.push(newOption);
    }

    return results.filter((result) => {
      return result.name.toLowerCase().includes(query.toLowerCase());
    });
  }

  /**
   * Generates a list of values that are legal for a specific device point
   */
  async generateDevicePointValueList(query, args) {
    args.device.log(`generate args for dev point: ${JSON.stringify(Object.keys(args))}`);

    if (args.devicePoint === 'undefined') return [];

    const results = await args.device.oAuth2Client.getDevicePointValues(args.device.instanceId, args.devicePoint.id);

    return results.filter((result) => {
      return result.name.toLowerCase().includes(query.toLowerCase());
    });
  }

  /**
   * Return the base path of the app. This is different on the Homey Bridge and the Homey Pro
   */
  async getBasePath() {
    if (this.homey.platform === 'cloud') {
      return '/app';
    }
    // Else platform = 'local', e.g. Homey Pro
    return '.';
  }

}

module.exports = myUplinkApp;

/**
 * Pending questions:
 * - Definition of which capabilities to use / link to capabilities
 * - Definition of which settings to use
 */
