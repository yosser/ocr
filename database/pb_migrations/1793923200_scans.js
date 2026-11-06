/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  const collection = new Collection({
    type: "base",
    name: "scans",
    listRule: "",
    viewRule: "",
    createRule: "",
    updateRule: "",
    deleteRule: "",
    indexes: [
      "CREATE INDEX idx_scans_created ON scans (created)",
    ],
    fields: [
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      { name: "text", type: "text", required: false, max: 20000 },
      {
        name: "kind",
        type: "select",
        required: true,
        maxSelect: 1,
        values: ["image", "writing"],
      },
      {
        name: "image",
        type: "file",
        required: true,
        maxSelect: 1,
        maxSize: 20971520,
        mimeTypes: ["image/jpeg", "image/png", "image/webp"],
        thumbs: ["200x0"],
      },
    ],
  })

  app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("scans")
  app.delete(collection)
})
