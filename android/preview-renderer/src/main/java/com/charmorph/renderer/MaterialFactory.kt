package com.charmorph.renderer

import com.google.android.filament.Engine
import com.google.android.filament.Material
import com.google.android.filament.filamat.MaterialBuilder

object MaterialFactory {

    // A basic PBR material source
    // Note: In production, load a pre-compiled .filamat asset.
    // Here we use MaterialBuilder for flexibility during dev.

    fun createPbrMaterial(engine: Engine): Material {
        val builder = MaterialBuilder()
            .name("DefaultPBR")
            .materialDomain(MaterialBuilder.MaterialDomain.SURFACE)
            .shading(MaterialBuilder.Shading.LIT)
            .blending(MaterialBuilder.BlendingMode.OPAQUE)

            // Attributes needed for PBR
            .require(MaterialBuilder.VertexAttribute.UV0)
            .require(MaterialBuilder.VertexAttribute.COLOR)

            // Parameters
            .samplerParameter(MaterialBuilder.SamplerType.SAMPLER_2D, MaterialBuilder.SamplerFormat.FLOAT, MaterialBuilder.ParameterPrecision.DEFAULT, "baseColorMap")
            .samplerParameter(MaterialBuilder.SamplerType.SAMPLER_2D, MaterialBuilder.SamplerFormat.FLOAT, MaterialBuilder.ParameterPrecision.DEFAULT, "normalMap")
            .samplerParameter(MaterialBuilder.SamplerType.SAMPLER_2D, MaterialBuilder.SamplerFormat.FLOAT, MaterialBuilder.ParameterPrecision.DEFAULT, "roughnessMap")
            .uniformParameter(MaterialBuilder.UniformType.FLOAT4, "baseColorFactor")
            .uniformParameter(MaterialBuilder.UniformType.FLOAT, "roughnessFactor")
            .uniformParameter(MaterialBuilder.UniformType.FLOAT, "metallicFactor")

            // Shader logic (Simplified for Builder)
            // Filament's Builder automatically generates standard PBR shader code
            // if we don't provide custom code, but we configure it to use the parameters.

        // Note: MaterialBuilder in Java/Kotlin is a wrapper.
        // Ideally, we construct the payload.
        // For robustness in this environment without complex shader files,
        // let's check if we can compile a simple source.

        // Actually, for Filament Android, compiling via Builder is the safest way to get a valid material package
        // without external tools.

        val matPackage = builder.build(engine)
        val buffer = matPackage.buffer
        val material = Material.Builder().payload(buffer, buffer.remaining()).build(engine)
        return material
    }
}
