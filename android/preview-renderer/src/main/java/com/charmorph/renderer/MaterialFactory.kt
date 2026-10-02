package com.charmorph.renderer

import com.google.android.filament.Engine
import com.google.android.filament.Material
import com.google.android.filament.filamat.MaterialBuilder

object MaterialFactory {

    fun createPbrMaterial(engine: Engine): Material {
        MaterialBuilder.init()
        val builder = MaterialBuilder()
            .name("DefaultPBR")
            .materialDomain(MaterialBuilder.MaterialDomain.SURFACE)
            .shading(MaterialBuilder.Shading.LIT)
            .blending(MaterialBuilder.BlendingMode.OPAQUE)
            .require(MaterialBuilder.VertexAttribute.UV0)
            .uniformParameter(MaterialBuilder.UniformType.FLOAT4, "baseColorFactor")
            .uniformParameter(MaterialBuilder.UniformType.FLOAT, "roughnessFactor")
            .uniformParameter(MaterialBuilder.UniformType.FLOAT, "metallicFactor")
            .material("void material() { prepareMaterial(material); material.baseColor = materialParams.baseColorFactor; material.roughness = materialParams.roughnessFactor; material.metallic = materialParams.metallicFactor; }")

        val matPackage = builder.build()
        val buffer = matPackage.buffer
        val material = Material.Builder().payload(buffer, buffer.remaining()).build(engine)
        return material
    }
}
