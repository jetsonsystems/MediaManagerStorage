# MediaManagerStorage/lib/gdrive

Interface to uplaod / download documents and / or assets to Google Drive.

## Usage

The module must be explicitly loaded via the storage interface getter *<b>get</b>* method:

    var gdrive = require('MediaManagerStorage').get('gdrive')

## API Object Formats
The following are objects used throughout the API.

<a name="account-desc"></a>
### accountDesc
Describes a user's linked Google Drive account.

  * *<b>type</b>*: "gdrive". <b>Required</b>.
  * *<b>user</b>*: Users Google account, ie: Google email address. <b>Optional</b>
  * *<b>code</b>*: The authorization code used to authenticate. <b>Optional</b>
  * *<b>accessToken</b>*: The access token for making requests. <b>Required</b>
  * *<b>refreshToken</b>*: Token to refresh the accessToken. <b>Optional</b>

<a name="location-desc"></a>
### locationDesc
Describes the location an asset will be uploaded to.

  * *<b>assetType</b>*: Type of asset the location is designated for.
    
    "any" || "original", Default: "original".
    
  * *<b>root</b>*: Root where data is to be stored.

    "appdata" || "mydrive", Default: "appdata"
  * *<b>basePrefix</b>*: Path within root where assets are to be stored. Default: "/".

    IE: /media/images/originals

  * *<b>folderId</b>*: The id of the folder represented by root/basePath, if known. Default: undefined.

<a name="asset-desc"></a>
### assetDesc
Describes an asset which is to be uploaded to Google Derive.

  * assetType: "original" is the default and only valid value at the moment. *<b>Optional.</b>*
  * docId: docId: Document ID of the document the asset is associated with. For example, if it is an [plm.Image](./plm-image/README.md) document, it is its *<b>oid</b>* attribute.
  * path: Path to document on local filesystem.

## Classes

### Uploader

An *<b>Uploader</b>* instances is responsible for uploading assets to Google Drive in a polite manner. A work queue is maintained, gdriveUploadQ, which is a FIFO queue. 

#### Constructor

    Uploader(accountDesc, persistDir, options)

Instantiates an uploader instances. It is an event emitter. See Events. 

Arguments:

  * *<b>accountDesc</b>*: Describes the Google account being used. See [AccoutDesc](#account-desc).
  * *<b>persistDir</b>*: Directory to persist work queues.
  * *<b>options</b>*:
    * dryRun: If true, will process the attempts according to constraints and log but not actually do the upload. <b>Default: false</b>
    * uploadqFile: Filename to persist the internal *<b>upload queue</b>*. Default is <b>gdrive-uploadq.json</b>.
    * minRequestInterval: Minimum time between requests, default = 1 sec. (1000 ms).
    * location: A [locationDesc](#location-desc) which describes where assets are to be stored.

#### Methods

  * <b>start()</b>: Initiate the upload process.
  * <b>stop()</b>: Stop the upload process, persisting queued data to disk. <b>Not implemented currently.</b>
  * <b>enqueue(*assetDesc*)</b>: Queues the asset for upload.
    * *<b>assetDesc</b>* Properties of the asset to upload. See [assetDesc](#asset-desc).

#### Events
Events are emitted as uploads occur. Events are all emitted with the event type and a single upload event paramater. For example:

    uploader.on(event, function(uploadEvent) {})
  
All upload events pass an *<b>uploadEvent</b>* object with the following attributes:

  * type: same as the event string.
  * uploadId: a unique ID for each upload.
  * emittedAt: when the event was emitted.
  * asset: the assetDesc passed to enqueue(). See [assetDesc](#asset-desc).
  * storageRef: a storageRef document.

##### uploader.upload.started
The upload started.
##### uploader.upload.success
The upload was successful.
##### uploader.upload.error
The upload resulted in an error.

## Methods

### upload(*assetDesc*, *accountDesc*[, *options*])

Upload a single asset to the specified Google Drive account.

### download(storageRef[, path])

Download a single asset as referenced by *<b>storageRef</b>*.