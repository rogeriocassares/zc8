"use server";

export async function createDevice(
  organizationId: string,
  formData: FormData
) {
  const apiBase =
    process.env.NEXT_PUBLIC_ELYSIA_API_URL || "http://localhost:3333";

  // Helper to parse numeric fields
  const parseNumber = (value: FormDataEntryValue | null): number => {
    if (!value || value === "") return 0;
    const num = Number(value);
    return Number.isNaN(num) ? 0 : num;
  };

  const data: Record<string, unknown> = {
    device_id: formData.get("device_id"),
    device_key: formData.get("device_key"),
    model: formData.get("model"),
    vendor_id: parseNumber(formData.get("vendor_id")),
    parser_id: parseNumber(formData.get("parser_id")),
    origin: formData.get("origin"),
    metadata: {
      description: formData.get("description"),
      location: formData.get("location"),
    },
  };

  // Only include optional fields if they have values
  const deveui = formData.get("deveui");
  if (deveui) data.deveui = deveui;

  try {
    console.log("Creating device with payload:", JSON.stringify(data, null, 2));
    const response = await fetch(
      `${apiBase}/api/tenants/${organizationId}/devices`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
      }
    );

    console.log("Create response status:", response.status);
    if (!response.ok) {
      const errorText = await response.text();
      console.error("Create device error:", errorText);
      throw new Error(`Failed to create device: ${errorText}`);
    }

    const result = await response.json();
    console.log("Create device success:", result);
    return { success: true, device: result };
  } catch (error) {
    console.error("Create device exception:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function updateDevice(
  organizationId: string,
  deviceId: string,
  formData: FormData,
  currentMetadata: Record<string, unknown> = {}
) {
  const apiBase =
    process.env.NEXT_PUBLIC_ELYSIA_API_URL || "http://localhost:3333";

  // Helper to parse numeric fields
  const parseNumber = (value: FormDataEntryValue | null): number | null => {
    if (!value || value === "") return null;
    const num = Number(value);
    return Number.isNaN(num) ? null : num;
  };

  const data: Record<string, unknown> = {
    model: formData.get("model"),
    origin: formData.get("origin"),
    status: formData.get("status"),
    metadata: {
      ...currentMetadata,
      description: formData.get("description"),
      location: formData.get("location"),
    },
  };

  // Only include numeric fields if they have values
  const vendorId = parseNumber(formData.get("vendor_id"));
  if (vendorId !== null) data.vendor_id = vendorId;

  const parserId = parseNumber(formData.get("parser_id"));
  if (parserId !== null) data.parser_id = parserId;

  // Only include optional fields if they have values
  const deveui = formData.get("deveui");
  if (deveui) data.deveui = deveui;

  try {
    console.log("Updating device with ID:", deviceId);
    console.log("Update payload:", JSON.stringify(data, null, 2));
    const response = await fetch(
      `${apiBase}/api/tenants/${organizationId}/devices/${deviceId}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
      }
    );

    console.log("Update response status:", response.status);
    if (!response.ok) {
      const errorText = await response.text();
      console.error("Update device error:", errorText);
      throw new Error(`Failed to update device: ${errorText}`);
    }

    const result = await response.json();
    console.log("Update device success:", result);
    return { success: true, device: result };
  } catch (error) {
    console.error("Update device exception:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
