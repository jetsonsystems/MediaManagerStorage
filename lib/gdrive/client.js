//
// Google Drive client helper library.
//
var fs = require('fs');
var url = require('url');
var util = require('util');

var _ = require('underscore');
var log4js = require('log4js');
var request = require('request');

var hostname = 'www.googleapis.com';

var moduleName = './lib/gdrive/client';

module.exports = function GDriveClient(accountDesc) {

  var logger = log4js.getLogger('plm.MediaManagerStorage');

  //
  // upload: Upload an asset to google drive.
  //
  //  Args:
  //    assetDesc: the asset.
  //    options:
  //      uploadType: 'media' || 'multipart', default: 'media'
  //      callback: f(error, response, body), as in request().
  //
  this.upload = function(assetDesc, options) {
    var logPrefix = moduleName + '.upload: ';
    var options = options || {};

    logger.info(logPrefix + 'Executing request to upload asset, account - ' + accountDesc.user + ', asset - ' + assetDesc.path);

    options.uploadType = options.uploadType || 'media';
    options.callback = options.callback || function() {};

    var query = {
      uploadType: options.uploadType
    };

    try {
      var uploadURI = url.format({
        protocol: 'https:',
        hostname: hostname,
        pathname: '/upload/drive/v2/files',
        query: query
      });
      if (options.uploadType === 'media') {
        fs.createReadStream(assetDesc.path).pipe(request({ uri: uploadURI,
                                                           headers: {
                                                             Authorization: "Bearer " + accountDesc.accessToken
                                                           },
                                                           method: 'POST'
                                                         },
                                                         options.callback));
      }
      else if (options.uploadType === 'multipart') {
        logger.info(logPrefix + 'Performing multipart upload...');
        var metadata = options.metadata || {};
        if (_.has(assetDesc, 'name')) {
          metadata['title'] = assetDesc.name;
        }
        else {
          metadata['title'] = _.last(assetDesc.path.split('/'));
        }
        var body = fs.readFileSync(assetDesc.path);
        logger.info(logPrefix + 'Asset meta data - ' + util.inspect(metadata));
        request({ method: 'POST',
                  uri: uploadURI,
                  headers: {
                    Authorization: "Bearer " + accountDesc.accessToken,
                    Connection: "close"
                  },
                  multipart: [
                    { 'content-type': 'application/json',
                      body: JSON.stringify(metadata)
                    },
                    { body: body }
                  ]
                },
                options.callback);
      }
    }
    catch (err) {
      logger.error(logPrefix + 'Error attempting upload - ' + err);
      if (options.callback) {
        options.callback(err);
      }
    }
  };

  //
  // refreshToken: Refresh the access token.
  //
  //  The request should look like:
  //
  //    curl --header 'Content-Type: application/x-www-form-urlencoded' -d 'client_id=XXXX&client_secret=XXXX&refresh_token=XXXX&grant_type=refresh_token' 'https://accounts.google.com/o/oauth2/token'
  //
  //  Response:
  //
  //  {
  //    "access_token" : "ya29.AHES6ZT2VPf5HyFLx7P1PTl_mHsFsjW23RnkM-AeTRdD1aA",
  //    "token_type" : "Bearer",
  //    "expires_in" : 3600
  //  }
  //
  this.refreshToken = function(accountDesc, callback) {
    var logPrefix = moduleName + '.refreshToken: ';
    var refreshURI = url.format({
      protocol: 'https:',
      hostname: 'accounts.google.com',
      pathname: '/o/oauth2/token'
    });
    logger.info(logPrefix + 'Refreshing access token, client_id - ' + accountDesc.clientId + ', client_secret - ' + accountDesc.clientSecret + ', refresh_token - ' + accountDesc.refreshToken);
    request({
      method: 'POST',
      uri: refreshURI,
      form: {
        client_id: accountDesc.clientId,
        client_secret: accountDesc.clientSecret,
        refresh_token: accountDesc.refreshToken,
        grant_type: "refresh_token"
      }},
            function(error, response, body) {
              logger.info(logPrefix + 'Access token refresh response, response status - ' + response.statusCode + ', body - ' + util.inspect(body));
              if (callback) {
                var accessToken = undefined;
                var expiresIn = undefined;
                if (response.statusCode === 200) {
                  try {
                    var jBody = JSON.parse(body);
                    accessToken = jBody.access_token;
                    expiresIn = jBody.expires_in;
                  }
                  catch (err) {
                    error = err;
                  }
                }
                callback(error, accessToken, expiresIn);
              }
            });
  };

};
