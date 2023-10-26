/* eslint-disable comma-dangle */

'use strict';

const { OAuth2Driver } = require('homey-oauth2app');
// const DeviceDefinition = require('./devices/Experimental.json');

class genericDriver extends OAuth2Driver {

  /**
   * onInit is called when the driver is initialized.
   */
  async onOAuth2Init() {
    // Register Flow Cards etc.
    this.log('Generic driver has been initialized');
  }

  /**
   * onPairListDevices is called when a user is adding a device
   * and the 'list_devices' view is called.
   * This should return an array with the data of devices that are available for pairing.
   */
  async onPairListDevices({ oAuth2Client }) {
    this.log('onPairListDevices');
    this.oAuth2Client = oAuth2Client;
    // this.oAuth2Client.deviceDefinition = DeviceDefinition;
    return oAuth2Client.discoverDevices(this);
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
      return this.oAuth2Client.getDevicePointValues(null, null, data);
    });
    super.onPair(session);
  }

  /**
   * onRepair is triggered when trying to repair a device.
   * @param session A PairSocket, similar to Driver.onPair
   * @param device A Homey.Device that's being repaired
   */
  async onRepair(session, device) {
    console.log('Re-pairing initiated');
    session.setHandler('getDevice', () => {
      const dev = {
        store: device.getStore(),
        data: device.getData()
      };
      console.log(dev);
      return Promise.resolve(dev);
    });

    session.setHandler('updateDevice', (dev) => {
      console.log('Updating the device capabilities');
      const oldCaps = device.getCapabilities();
      const newCaps = dev.capabilities;
      console.log(`Old caps: ${oldCaps}`);
      console.log(`New caps: ${newCaps}`);
      device.setStoreValue('onoffDefs', dev.store.onoffDefs);
      device.setStoreValue('termoDefs', dev.store.termoDefs);
      device.setStoreValue('tempDefs', dev.store.tempDefs);
      device.setStoreValue('powerDefs', dev.store.powerDefs);
      device.setStoreValue('meterDefs', dev.store.meterDefs);
      device.setStoreValue('alarmDefs', dev.store.alarmDefs);
      device.setStoreValue('onChange', dev.store.onChange);
      device.setStoreValue('capTable', dev.store.capTable);
      device.setStoreValue('onCreated', dev.store.onCreated);
      device.setStoreValue('doneInit', false);

      for (let i = 0; i < oldCaps.length; i++) {
        if (!newCaps.includes(oldCaps[i])) {
          console.log(`Removing capability ${oldCaps[i]}`);
          device.removeCapability(oldCaps[i]);
        }
      }
      for (let i = 0; i < newCaps.length; i++) {
        if (!oldCaps.includes(newCaps[i])) {
          console.log(`Adding new Capability ${newCaps[i]}`);
          device.addCapability(newCaps[i]);
        }
      }
      // eslint-disable-next-line no-restricted-syntax, guard-for-in
      for (const cap in dev.capabilitiesOptions) {
        console.log(`Adding capabilityoptions for ${cap}`);
        device.setCapabilityOptions(cap, dev.capabilitiesOptions[cap]);
      }
      device.oAuth2Client.unInitDevice(device.instanceId);
      device.oAuth2Client.initDevice(device, device.deviceDefinition);
      return session.done();
    });

    session.setHandler('getDevicePoints', (data) => {
      const locale = 'en'; // this.homey.i18n.getLanguage();
      return device.oAuth2Client.getDevicePoints(data.deviceId, {}, locale)
        .then((devicePoints) => device.oAuth2Client.mapDevPoints(devicePoints))
        .catch((err) => {
          console.log(`error: ${err}`);
        });
    });

    session.setHandler('getDevicePointValues', (data) => {
      return device.oAuth2Client.getDevicePointValues(null, null, data);
    });

    // session.setHandler("disconnect", () => {
    //   // Cleanup
    // });
    super.onRepair(session, device);
  }

}

module.exports = genericDriver;
