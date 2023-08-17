/* eslint-disable import/no-useless-path-segments */
/* eslint-disable no-restricted-syntax */
/* eslint-disable comma-dangle */
/* eslint-disable no-nested-ternary */

'use strict';

const { OAuth2Device } = require('homey-oauth2app');
const DeviceDefinition = require('./deviceDefinition.json');
const { TYPE } = require('../../lib/common');

class genericDevice extends OAuth2Device {

  async onSettings({ oldSettings, newSettings, changedKeys }) {
    this.log('Settings changed - ');
    this.log(oldSettings);
    this.log('New settings');
    this.log(newSettings);
    this.log('keys');
    this.log(changedKeys);
    return Promise.resolve();
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * onOAuth2Init is called when the device is initialized.
   */
  async onOAuth2Init() {
    this.deviceDefinition = DeviceDefinition;
    this.log(`Initializing device of type ${this.deviceDefinition.name}`);
    try {
      this.setUnavailable('Initializing device.');
      this.deviceId = this.getData().deviceId;
      this.killed = false;

      // === Backward compatibility ===
      // Add when needed:
      // - Convert deprecated state
      // - Add capabilities for capabilities added after the first version
      //   | const capabilityName = 'measure_humidity.myCapability';
      //   | if (!this.hasCapability(capabilityName)) {
      //   |   await this.addCapability(capabilityName);
      //   | }
      // - Set capabilityOptions that has changed
      //   | const options = {
      //   |   title: { en: 'ugg' },
      //   |   units: { en: 'blah' },
      //   |   decimals: 2,
      //   | };
      //   | await this.setCapabilityOptions(capabilityName, options).catch(this.error);

      await this.oAuth2Client.initDevice(this, this.deviceDefinition);

      // Add action cards
      const cardActionSetDevicePoint = this.homey.flow.getActionCard('set_devicepoint');
      cardActionSetDevicePoint.registerRunListener(async (args) => {
        return this.onSetDevicePoint(args.devicePoint.id, args.newValue.id);
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
        return this.onSetDevicePoint(args.devicePoint.id, args.newValue);
      });
      cardActionSetDevicePointNumeric.registerArgumentAutocompleteListener(
        'devicePoint',
        async (query, args) => {
          return this.generateDevicePointList(query, args, true);
        }
      );

      // Add condition cards
      const cardConditionEqualDevicePoint = this.homey.flow.getConditionCard('devicepoint_is');
      cardConditionEqualDevicePoint.registerRunListener(async (args, state) => {
        const value = +args.value.id;
        const stateValue = +this.oAuth2Client.confirmedDevicePoints[args.devicePoint.id];
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

      // Add trigger cards
      const cardTriggerDevicePointChanged = this.homey.flow.getDeviceTriggerCard('devicepoint_changed');
      cardTriggerDevicePointChanged.registerRunListener(async (args, state) => {
        return Promise.resolve(+state.devicePoint === +args.devicePoint.id);
      });
      cardTriggerDevicePointChanged.registerArgumentAutocompleteListener(
        'devicePoint',
        async (query, args) => {
          return this.generateDevicePointList(query, args, false);
        }
      );

      // Initialization complete
      this.setAvailable();
    } catch (err) {
      this.log(`onOAuth2Init err: ${err}`);
    }
  }

  // Called whenever the driver is uninstalled
  async onOAuth2Deleted() {
    this.killed = true;
    this.log('onOAuth2Deleted');
  }

  /**
   * Sets the
   */
  async onSetDevicePoint(devicePoint, newValue) {
    const devPointDef = this.deviceDefinition.devPointTable[devicePoint];
    const legalValues = devPointDef.enumValues.map((item) => item.value);

    if (!devPointDef.writable) return Promise.reject(new Error(`Device point ${devicePoint} is not writeable.`));
    switch (devPointDef.type) {
      case TYPE.ENUM:
        if (!legalValues.includes(newValue)) return Promise.reject(new Error(`Invalid value ${newValue} for device point ${devicePoint}`));
        break;
      case TYPE.NUMBER:
        if ((+newValue < (devPointDef.minValue * +devPointDef.scaleValue))
          || (+newValue > (devPointDef.maxValue * +devPointDef.scaleValue))) {
          return Promise.reject(new Error(`Invalid value ${newValue} for device point ${devicePoint}`));
        }
        break;
      default:
        return Promise.reject(new Error(`Unknown device point type for device point ${devicePoint}`));
    }

    const newState = {};
    newState[devicePoint] = +newValue;
    return this.oAuth2Client.setDevicePoint(this.deviceId, newState);
  }

  /**
   * Called when a value read from myUplink has been confirmed changed (not when the change happened)
   */
  async onDevicePointChanged(devicePoint, value, strVal) {
    if (this.killed) return Promise.resolve();
    const cardTriggerDevicePointChanged = this.homey.flow.getDeviceTriggerCard('devicepoint_changed');
    const tokens = { value, strVal };
    const state = { devicePoint };
    return cardTriggerDevicePointChanged.trigger(this, tokens, state);
  }

  /**
   * Generates a list of device points that can be set
   */
  async generateDevicePointList(query, args, writableOnly) {
    const devpointMap = args.device.deviceDefinition.devPointTable;
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

    const results = await args.device.oAuth2Client.getDevicePointValues(args.devicePoint.id);

    return results.filter((result) => {
      return result.name.toLowerCase().includes(query.toLowerCase());
    });
  }

}

module.exports = genericDevice;
