# MediaManagerStorage/lib/gdrive

Interface to uplaod / download documents and / or assets to Google Drive.

## Usage

The module must be explicitly loaded via the storage interface getter *<b>get</b>* method:

    var gdrive = require('MediaManagerStorage').get('gdrive')

## Classes

### Uploader

An *<b>Uploader</b>* instances is responsible for uploading assets to Google Drive in a polite manner. A work queue is maintained, gdriveUploadQ, which is a FIFO queue. 

#### Constructor

    Uploader(accountDesc, persistDir, options)

Instantiates an uploader instances. It is an event emitter. See Events. 

Arguments:

  * *<b>accountDesc</b>*: Describes the Google account being used. Contains:
    * accessToken: The access token for making requests. <b>Required</b>
    * refreshToken: Token to refresh the accessToken. <b>Optional</b>
  * *<b>persistDir</b>*: Directory to persist work queues.
  * *<b>options</b>*:
    * dryRun: If true, will process the attempts according to constraints and log but not actually do the upload. <b>Default: false</b>
    * uploadqFile: Filename to persist the internal *<b>upload queue</b>*. Default is <b>gdrive-uploadq.json</b>.

#### Methods

  * <b>start()</b>: Initiate the upload process.
  * <b>stop()</b>: Stop the upload process, persisting queued data to disk.
  * <b>pause()</b>: 
  * <b>restart()</b>:
  * <b>enqueue(*assetDesc*)</b>: Queues the asset for upload.
    * *<b>assetDesc</b>* Properties of the asset to upload.
      * doc_id: doc_id: Document ID of the document the asset is associated with. For example, if it is an [plm.Image](./plm-image/README.md) document, it is its *<b>oid</b>* attribute.
      * path: Path to document on local filesystem.

#### Events


## Methods

### upload(*assetDesc*, *accountDesc*[, *options*])

Upload a single asset to the specified Google Drive account.

### download(storageRef[, path])

Download a single asset as referenced by *<b>storageRef</b>*.