# StorageRef
A *<b>StorageRef</b>* describes a reference to a document or asset (ie: file) in some data store. The document is ussually associated with some other PLM document. For example, an image's meta-data is stored in a [plm.Image](./plm-image/README.md) document, but the imported image file may be stored in some other data store such as a cloud service like Google Drive, for example. A *<b>StorageRef</b>* will be used to capture where the actual imported file is stored.

## Public Attributes

  * *<b>class_name</b>*: plm.StorageRef
  * *<b>doc_id</b>*: PLM doc this reference is associated with. IE: oid of a plm.Image document.
  * *<b>desc</b>*: 'gdrive'
  * *<b>state</b>*: Attributes associated with the process of storing the asset, or any other state. Common to all providers / mechanisms. An object containing the following attributes:
    * status: <storage status>

          <storage status> ::= unknown | 'queued' | 'in-progress' | 'stored' | 'error'

          Provides indication of whether the asset is in the process of being stored, or has been stored:

            unknown: initial status.
            in-progress: storing the document / asset is in progress.
            stored: successfully stored.
            error: there was an error in storing the document.

    * store_started_at: <timestamp of when upload started>
    * store_completed_at: <timestamp of when upload completed>

  * *<b>ref</b>*: Meta-data required to reference the asset. This could include things like URLs or IDs specific to the provider identified by the *<b>desc</b>* attribute.

## Google Drive
The *<b>desc</b>* attribute will have a value of <b>gdrive</b>. 

The *<b>ref</b>* attribute is an object containing meta-data required to access the document on Google Drive. It will contain the following attributes:

  * account: Google account / username associated with the account used to store the asset. The user's Google email address.
  * file_id: Google Drive file ID to use to retrieve file.

Note, a "File Resource":https://developers.google.com/drive/v2/reference/files#resource contains a downloadUrl. That is a "short lived" URL, and is hence NOT captured in the *<b>ref</b>* meta-data.