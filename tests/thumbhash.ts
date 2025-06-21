import sharp from "sharp"
import checksum from "checksum"
import { configThumbHash, rgbaToThumbHash, thumbHashToRGBA } from "../js/thumbhash"

const fs = require('node:fs')

const files = fs.readdirSync(".").filter(file => file.endsWith(".jpeg"))
// console.log(files)

const process = async (file) => {
    const image = sharp(file).resize(100, 100, { fit: "inside" })
    const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const binaryThumbHash = rgbaToThumbHash(info.width, info.height, data)
    // console.log(binaryThumbHash)
    // console.log(Buffer.from(binaryThumbHash).toString("hex")) 

    {
        file = file.replace(".jpeg", ".png")
        const image = thumbHashToRGBA(binaryThumbHash)
        console.log(checksum(image.rgba, { algorithm: "sha256" }), "", Buffer.from(binaryThumbHash).toString("hex"))
        const _ = sharp(image.rgba as Uint8Array, {
            raw: {
                width: image.w,
                height: image.h,
                channels: 4,
            }
        }).png()
        await _.toFile(file)
        const data = await _.toBuffer()
        console.log(checksum(data, { algorithm: "sha256" }), "", file)
        // console.log(checksum(file, { algorithm: "sha256" }), "", file)

        // const placeholderURL = thumbHashToDataURL(binaryThumbHash)
        // console.log(placeholderURL)
    }
}

const main = async () => {
    configThumbHash(3, 3)

    for (const file of files) {
        // console.log(`Processing ${file}...`)
        await process(file)
        break
    }
}

main()
