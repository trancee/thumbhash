import sharp from "sharp"
import { rgbaToThumbHash, thumbHashToRGBA } from "../js/thumbhash"

const fs = require('node:fs')

const files = fs.readdirSync(".").filter(file => file.endsWith(".jpeg"))
console.log(files)

const main = async (file) => {
    const image = sharp(file).resize(100, 100, { fit: "inside" })
    const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const binaryThumbHash = rgbaToThumbHash(info.width, info.height, data)
    console.log(binaryThumbHash)
    console.log(Buffer.from(binaryThumbHash))

    {
        const image = thumbHashToRGBA(binaryThumbHash)
        await sharp(image.rgba as Uint8Array, {
            raw: {
                width: image.w,
                height: image.h,
                channels: 4,
            }
        }).toFile("thumbhash.png")

        // const placeholderURL = thumbHashToDataURL(binaryThumbHash)
        // console.log(placeholderURL)
    }
}

files.forEach(file => {
    console.log(`Processing ${file}...`)
    main(file)
})
