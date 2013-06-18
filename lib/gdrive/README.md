# MediaManagerStorage/lib/gdrive

Interface to uplaod / download documents and / or assets to Google Drive.

## Usage

The module must be explicitly loaded via the storage interface getter *<b>get</b>* method:

    var gdrive = require('MediaManagerStorage').get('gdrive')

## Classes

### Uploader

#### Constructor

    Uploader(q, account, options)

Instantiates an uploader instances. It is an event emitter. See Events.

#### Methods

  * start(): Initiate the upload process.
  * stop(): Stop the upload process.

#### Events

## Methods

### upload()
### download()
