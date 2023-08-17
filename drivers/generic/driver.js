/* eslint-disable comma-dangle */

'use strict';

const { OAuth2Driver } = require('homey-oauth2app');
const DeviceDefinition = require('./deviceDefinition.json');

class genericDriver extends OAuth2Driver {

  /**
   * onInit is called when the driver is initialized.
   */
  async onOAuth2Init() {
    // Register Flow Cards etc.
    this.log(`${DeviceDefinition.name} driver has been initialized`);
  }

  /**
   * onPairListDevices is called when a user is adding a device
   * and the 'list_devices' view is called.
   * This should return an array with the data of devices that are available for pairing.
   */
  async onPairListDevices({ oAuth2Client }) {
    this.log('onPairListDevices');
    this.oAuth2Client = oAuth2Client;
    this.oAuth2Client.deviceDefinition = DeviceDefinition;
    return oAuth2Client.discoverDevices(DeviceDefinition.filter);
  }

  /**
   * onPair is triggered when trying to pair a device with homey. It links up functions
   * that need to be available during the pairing process.
   * The onPair function is only used by the generic driver, not the device specific drivers
   */
  async onPair(session) {
    session.setHandler('getDevicePoints', (data) => {
      const locale = 'en'; // this.homey.i18n.getLanguage();
      return this.oAuth2Client.getDevicePoints(data.deviceId, {}, locale)
        .then((devicePoints) => this.oAuth2Client.mapDevPoints(devicePoints))
        .catch((err) => {
          console.log(`error: ${err}`);
        });
    });
    session.setHandler('getDevicePointValues', (data) => {
      return this.oAuth2Client.getDevicePointValues(null, data);
    });
    super.onPair(session);
  }

}

module.exports = genericDriver;
