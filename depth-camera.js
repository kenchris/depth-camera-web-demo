/*jshint esversion: 6 */

// Copyright 2017 Intel Corporation.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

  class DepthCamera {

    constructor() {
    }

    static async getDepthStream() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices ||
        !navigator.mediaDevices.getUserMedia) {
        throw new Error("Your browser doesn't support the required mediaDevices APIs.");
      }

      const constraints = {
        audio: false,
        video: {
          // We don't use videoKind as it is still under development.
          // videoKind: {exact: "depth"}, R200 related hack: prefer
          // depth (width = 628) to IR (width = 641) stream.
          width: { ideal: 628, max: 640 },

          // SR300 depth camera enables capture at 110 frames per second.
          frameRate: { ideal: 110 },
        }
      }

      let stream = await navigator.mediaDevices.getUserMedia(constraints);
      let track = stream.getVideoTracks()[0];
      if (track.label.indexOf("RealSense") == -1) {
        throw new Error(chromeVersion() < 58 ?
          "Your browser version is too old. Get Chrome version 58 or later." :
          "No RealSense camera connected.");
      }

      if (track.getSettings && track.getSettings().frameRate > 60) {
        // After Chrome 59, returned track is scaled to 628 and frameCount 110.
        // We got the deviceId, so we the deviceId to select the stream with
        // default resolution and frameRate.
        track.stop();

        const constraints = {
          audio: false,
          video: {
            deviceId: { exact: track.getSettings().deviceId }
          }
        }
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        track = stream.getVideoTracks()[0];
      }
      return stream;
    }

  // Call the method after getting depth_stream using getDepthStream.
  static async getColorStreamForDepthStream(depthStream, idealWidth) {
    // To get color stream from the same physical device providing the depth
    // stream, we will use groupId, once it is implemented:
    // See https://crbug.com/627793
    // For now, enumerate devices based on label.
    // Note: depth_stream is not used, for now, but deliberatelly added as a
    // parameter to mandate the need for previous call to getDepthStream.

    let depthDeviceId = null;
    const depth = depthStream.getVideoTracks()[0];

    // Chrome, starting with version 59, implements getSettings() API.
    if (depth.getSettings) {
      depthDeviceId = depth.getSettings().deviceId;
    } else if (idealWidth) {
      console.warn(`Not able to set ideal width for color video as
        MediaStreamTrack getSettings() API is not available. Try
        with Chromium version > 59.`);
    }

    var potentialDevices = await navigator.mediaDevices.enumerateDevices();
    const devices = potentialDevices.filter(
      device => (
        device.kind == "videoinput" &&
        device.label.indexOf("RealSense") !== -1 &&
        device.deviceId != depthDeviceId
      )
    );
    if (devices.length < 1) {
      throw new Error("No RealSense camera connected.");
    }

    // Select streams from these ids, so that some other camera doesn't get
    // selected (e.g. if the user has another rgb camera).
    const ids = devices.map(device => device.deviceId);

    // Select color stream.
    // Color stream tracks have larger resolution than depth stream
    // tracks. If we cannot use deviceId to select, for now, we need
    // to misuse width.
    const constraints = {
      video: { deviceId: { exact: ids } }
    }

    if (idealWidth) {
      constraints.video.width = { ideal: ids.length == 1 ? idealWidth : 1280 };
    }

    return navigator.mediaDevices.getUserMedia(constraints);
  }

  // Figure out the camera intristics and extrinsics based on the depth stream
  // camera model.
  //
  // This should be rewritten once the MediaCapture-Depth API works - don't
  // hardcode the values based on camera model, but query it from the API.
  //
  // See the documentation at
  // https://w3c.github.io/mediacapture-depth/#synchronizing-depth-and-color-video-rendering
  static getCameraCalibration(depthStream) {
    const label = depthStream.getVideoTracks()[0].label;
    const cameraName = label.includes("R200") ? "R200"
      : (label.includes("Camera S") || label.includes("SR300")) ? "SR300"
      : label;

    const DistortionModel = {
      NONE: 0,
      MODIFIED_BROWN_CONRADY: 1,
      INVERSE_BROWN_CONRADY: 2,
    };

    let result;
    if (cameraName === "R200")  {
      result = {
        depthScale: 0.001,
        depthOffset: new Float32Array(
          [ 233.3975067138671875, 179.2618865966796875 ]
        ),
        depthFocalLength: new Float32Array(
          [ 447.320953369140625, 447.320953369140625 ]
        ),
        colorOffset: new Float32Array(
          [ 311.841033935546875, 229.7513275146484375 ]
        ),
        colorFocalLength: new Float32Array(
          [ 627.9630126953125, 634.02410888671875 ]
        ),
        depthToColor: [
          0.99998325109481811523, 0.002231199527159333229, 0.00533978315070271492, 0,
          -0.0021383403800427913666, 0.99984747171401977539, -0.017333013936877250671, 0,
          -0.0053776423446834087372, 0.017321307212114334106, 0.99983555078506469727, 0,
          -0.058898702263832092285, -0.00020283895719330757856, -0.0001998419174924492836, 1
        ],
        depthDistortionModel: DistortionModel.NONE,
        depthDistortioncoeffs: [ 0, 0, 0, 0, 0 ],
        colorDistortionModel: DistortionModel.MODIFIED_BROWN_CONRADY,
        colorDistortioncoeffs: [
          -0.078357703983783721924,
          0.041351985186338424683,
          -0.00025565386749804019928,
          0.0012357287341728806496,
          0
        ],
      };
    } else if (cameraName === "SR300")  {
      result = {
        depthScale: 0.0001249866472790017724,
        depthOffset: new Float32Array(
          [ 310.743988037109375, 245.1811676025390625 ]
        ),
        depthFocalLength: new Float32Array(
          [ 475.900726318359375, 475.900726318359375]
        ),
        colorOffset: new Float32Array(
          [ 312.073974609375, 241.969329833984375 ]
        ),
        colorFocalLength: new Float32Array(
          [ 617.65087890625, 617.65093994140625 ]
        ),
        depthToColor: [
          0.99998641014099121094, -0.0051436689682304859161, 0.00084982655243948101997, 0,
          0.0051483912393450737, 0.99997079372406005859, -0.005651625804603099823, 0,
          -0.00082073162775486707687, 0.0056559243239462375641, 0.99998366832733154297, 0,
          0.025699997320771217346, -0.00073326355777680873871, 0.0039400043897330760956, 1
        ],
        depthDistortionModel: DistortionModel.INVERSE_BROWN_CONRADY,
        depthDistortioncoeffs: [
          0.14655706286430358887,
          0.078352205455303192139,
          0.0026113723870366811752,
          0.0029218809213489294052,
          0.066788062453269958496,
        ],
        colorDistortionModel: DistortionModel.NONE,
        colorDistortioncoeffs: [ 0, 0, 0, 0, 0 ],
      };
    } else {
        throw {
          name: "CameraNotSupported",
          message: `Sorry, your camera '${cameraName}' is not supported`
        };
    }
    // This also de-normalizes the depth value (it's originally a 16-bit
    // integer, normalized into a float between 0 and 1).
    result.depthScale = result.depthScale * 65535;

    return result;
  }
}

function chromeVersion() {
  const raw = navigator.userAgent.match(/Chrom(e|ium)\/([0-9]+)\./);
  return raw ? parseInt(raw[2], 10) : false;
}