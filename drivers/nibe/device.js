/* eslint-disable import/no-useless-path-segments */
/* eslint-disable no-restricted-syntax */
/* eslint-disable comma-dangle */
/* eslint-disable no-nested-ternary */

'use strict';

const { OAuth2Device } = require('homey-oauth2app');
const fs = require('fs');
const { TYPE } = require('../../lib/common');

class genericDevice extends OAuth2Device {

  async onSettings({ oldSettings, newSettings, changedKeys }) {
    this.log('Settings changed - ');
    if (changedKeys.length === 0) {
      return Promise.resolve();
    }
    const newState = {};
    for (let i = 0; i < changedKeys.length; i++) {
      const settingName = changedKeys[i];
      if (settingName.substring(0, 8) === 'setting_') {
        const newVal = newSettings[settingName];
        const devicePoint = settingName.substring(8);
        newState[devicePoint] = +newVal;
      }
    }
    if (Object.keys(newState).length > 0) {
      this.log('Saved setting changes to myUplink:');
      this.log(newState);
      return this.oAuth2Client.setDevicePoint(this.instanceId, newState);
    }
    return Promise.resolve();
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * onOAuth2Init is called when the device is initialized.
   */
  async onOAuth2Init() {
    try {
      this.setUnavailable('Initializing device.');
      this.log('Reading device definitions');
      this.setupData = this.getData();
      const fileName = ('definitionFile' in this.setupData) ? this.setupData.definitionFile : 'Experimental.json';
      const fullFileName = `${await this.homey.app.getBasePath()}/drivers/${this.driver.id}/devices/${fileName}`;
      this.deviceDefinition = JSON.parse(fs.readFileSync(fullFileName));

      this.log(`Initializing device of type '${this.deviceDefinition.name}'`);
      this.deviceId = this.setupData.deviceId;
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

      // Initialization complete
      this.setAvailable();
    } catch (err) {
      this.setUnavailable(err);
      this.log(`onOAuth2Init err: ${err}`);
    }
  }

  // Called whenever the driver is uninstalled
  async onOAuth2Deleted() {
    this.killed = true;
    this.log('onOAuth2Deleted');
  }

  /**
   * Called when a flow is called to set a devicePoint
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
    // When the devicepoint has been set, immediately trigger a read of the devicepoint in order to trigger internal state updates
    return this.oAuth2Client.setDevicePoint(this.instanceId, newState)
      .then(() => this.oAuth2Client.getDevicePoints(this.deviceId, String(devicePoint)));
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

}

module.exports = genericDevice;
