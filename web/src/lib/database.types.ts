export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      bundle_components: {
        Row: {
          bundle_sku: string
          component_sku: string
          price: number | null
          qty: number
        }
        Insert: {
          bundle_sku: string
          component_sku: string
          price?: number | null
          qty?: number
        }
        Update: {
          bundle_sku?: string
          component_sku?: string
          price?: number | null
          qty?: number
        }
        Relationships: [
          {
            foreignKeyName: "bundle_components_bundle_sku_fkey"
            columns: ["bundle_sku"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["sku"]
          },
        ]
      }
      demand_runs: {
        Row: {
          drafts_created: number
          facilities_planned: number
          id: number
          lines_suggested: number
          run_at: string
          run_by: string | null
          trigger: string
        }
        Insert: {
          drafts_created?: number
          facilities_planned?: number
          id?: never
          lines_suggested?: number
          run_at?: string
          run_by?: string | null
          trigger?: string
        }
        Update: {
          drafts_created?: number
          facilities_planned?: number
          id?: never
          lines_suggested?: number
          run_at?: string
          run_by?: string | null
          trigger?: string
        }
        Relationships: []
      }
      doc_counters: {
        Row: {
          last_no: number
          period: string
          prefix: string
        }
        Insert: {
          last_no?: number
          period: string
          prefix: string
        }
        Update: {
          last_no?: number
          period?: string
          prefix?: string
        }
        Relationships: []
      }
      facilities: {
        Row: {
          address: string | null
          city: string | null
          code: string
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          default_margin_pct: number
          fulfiller_ss_id: number | null
          gstin: string | null
          id: number
          is_active: boolean
          is_consignment: boolean
          lead_time_days: number
          legal_name: string | null
          name: string
          notes: string | null
          pincode: string | null
          planning_enabled: boolean
          pos_location: string | null
          region: string | null
          restrict_to_assortment: boolean
          review_days: number
          safety_days: number
          state: string | null
          type: Database["public"]["Enums"]["facility_type"]
        }
        Insert: {
          address?: string | null
          city?: string | null
          code: string
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          default_margin_pct?: number
          fulfiller_ss_id?: number | null
          gstin?: string | null
          id?: never
          is_active?: boolean
          is_consignment?: boolean
          lead_time_days?: number
          legal_name?: string | null
          name: string
          notes?: string | null
          pincode?: string | null
          planning_enabled?: boolean
          pos_location?: string | null
          region?: string | null
          restrict_to_assortment?: boolean
          review_days?: number
          safety_days?: number
          state?: string | null
          type: Database["public"]["Enums"]["facility_type"]
        }
        Update: {
          address?: string | null
          city?: string | null
          code?: string
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          default_margin_pct?: number
          fulfiller_ss_id?: number | null
          gstin?: string | null
          id?: never
          is_active?: boolean
          is_consignment?: boolean
          lead_time_days?: number
          legal_name?: string | null
          name?: string
          notes?: string | null
          pincode?: string | null
          planning_enabled?: boolean
          pos_location?: string | null
          region?: string | null
          restrict_to_assortment?: boolean
          review_days?: number
          safety_days?: number
          state?: string | null
          type?: Database["public"]["Enums"]["facility_type"]
        }
        Relationships: [
          {
            foreignKeyName: "facilities_fulfiller_ss_id_fkey"
            columns: ["fulfiller_ss_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
        ]
      }
      facility_assortment: {
        Row: {
          added_at: string
          default_bucket: Database["public"]["Enums"]["stock_bucket"]
          facility_id: number
          is_active: boolean
          margin_pct: number | null
          max_qty: number
          min_qty: number
          msp: number | null
          sku: string
        }
        Insert: {
          added_at?: string
          default_bucket?: Database["public"]["Enums"]["stock_bucket"]
          facility_id: number
          is_active?: boolean
          margin_pct?: number | null
          max_qty?: number
          min_qty?: number
          msp?: number | null
          sku: string
        }
        Update: {
          added_at?: string
          default_bucket?: Database["public"]["Enums"]["stock_bucket"]
          facility_id?: number
          is_active?: boolean
          margin_pct?: number | null
          max_qty?: number
          min_qty?: number
          msp?: number | null
          sku?: string
        }
        Relationships: [
          {
            foreignKeyName: "facility_assortment_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facility_assortment_sku_fkey"
            columns: ["sku"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["sku"]
          },
        ]
      }
      facility_category_margins: {
        Row: {
          category_name: string
          facility_id: number
          margin_pct: number
        }
        Insert: {
          category_name: string
          facility_id: number
          margin_pct: number
        }
        Update: {
          category_name?: string
          facility_id?: number
          margin_pct?: number
        }
        Relationships: [
          {
            foreignKeyName: "facility_category_margins_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
        ]
      }
      facility_ops: {
        Row: {
          facility_id: number
          user_id: string
        }
        Insert: {
          facility_id: number
          user_id: string
        }
        Update: {
          facility_id?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "facility_ops_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facility_ops_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      fulfilment_order_lines: {
        Row: {
          fo_id: number
          id: number
          qty: number
          request_line_id: number | null
          sku: string
        }
        Insert: {
          fo_id: number
          id?: never
          qty: number
          request_line_id?: number | null
          sku: string
        }
        Update: {
          fo_id?: number
          id?: never
          qty?: number
          request_line_id?: number | null
          sku?: string
        }
        Relationships: [
          {
            foreignKeyName: "fulfilment_order_lines_fo_id_fkey"
            columns: ["fo_id"]
            isOneToOne: false
            referencedRelation: "fulfilment_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fulfilment_order_lines_request_line_id_fkey"
            columns: ["request_line_id"]
            isOneToOne: false
            referencedRelation: "order_request_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fulfilment_order_lines_request_line_id_fkey"
            columns: ["request_line_id"]
            isOneToOne: false
            referencedRelation: "v_request_lines"
            referencedColumns: ["request_line_id"]
          },
          {
            foreignKeyName: "fulfilment_order_lines_sku_fkey"
            columns: ["sku"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["sku"]
          },
        ]
      }
      fulfilment_orders: {
        Row: {
          closed_at: string | null
          created_at: string
          facility_id: number
          fo_no: string
          fulfiller_id: number
          id: number
          request_id: number
          status: Database["public"]["Enums"]["fo_status"]
        }
        Insert: {
          closed_at?: string | null
          created_at?: string
          facility_id: number
          fo_no: string
          fulfiller_id: number
          id?: never
          request_id: number
          status?: Database["public"]["Enums"]["fo_status"]
        }
        Update: {
          closed_at?: string | null
          created_at?: string
          facility_id?: number
          fo_no?: string
          fulfiller_id?: number
          id?: never
          request_id?: number
          status?: Database["public"]["Enums"]["fo_status"]
        }
        Relationships: [
          {
            foreignKeyName: "fulfilment_orders_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fulfilment_orders_fulfiller_id_fkey"
            columns: ["fulfiller_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fulfilment_orders_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "order_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      grn_lines: {
        Row: {
          bucket: Database["public"]["Enums"]["stock_bucket"]
          damaged_qty: number
          expected_qty: number
          grn_id: number
          id: number
          notes: string | null
          quarantine_qty: number
          reason: Database["public"]["Enums"]["discrepancy_reason"]
          received_qty: number
          rejected_qty: number
          shipment_line_id: number | null
          sku: string
        }
        Insert: {
          bucket?: Database["public"]["Enums"]["stock_bucket"]
          damaged_qty?: number
          expected_qty?: number
          grn_id: number
          id?: never
          notes?: string | null
          quarantine_qty?: number
          reason?: Database["public"]["Enums"]["discrepancy_reason"]
          received_qty?: number
          rejected_qty?: number
          shipment_line_id?: number | null
          sku: string
        }
        Update: {
          bucket?: Database["public"]["Enums"]["stock_bucket"]
          damaged_qty?: number
          expected_qty?: number
          grn_id?: number
          id?: never
          notes?: string | null
          quarantine_qty?: number
          reason?: Database["public"]["Enums"]["discrepancy_reason"]
          received_qty?: number
          rejected_qty?: number
          shipment_line_id?: number | null
          sku?: string
        }
        Relationships: [
          {
            foreignKeyName: "grn_lines_grn_id_fkey"
            columns: ["grn_id"]
            isOneToOne: false
            referencedRelation: "grns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grn_lines_shipment_line_id_fkey"
            columns: ["shipment_line_id"]
            isOneToOne: false
            referencedRelation: "shipment_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grn_lines_sku_fkey"
            columns: ["sku"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["sku"]
          },
        ]
      }
      grn_photos: {
        Row: {
          created_at: string
          grn_id: number
          grn_line_id: number | null
          id: number
          storage_path: string
        }
        Insert: {
          created_at?: string
          grn_id: number
          grn_line_id?: number | null
          id?: never
          storage_path: string
        }
        Update: {
          created_at?: string
          grn_id?: number
          grn_line_id?: number | null
          id?: never
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "grn_photos_grn_id_fkey"
            columns: ["grn_id"]
            isOneToOne: false
            referencedRelation: "grns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grn_photos_grn_line_id_fkey"
            columns: ["grn_line_id"]
            isOneToOne: false
            referencedRelation: "grn_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      grns: {
        Row: {
          cartons_received: number | null
          dc_no: string | null
          dn_no: string | null
          facility_id: number
          gate_pass_no: string | null
          grn_no: string
          has_discrepancy: boolean
          id: number
          invoice_no: string | null
          notes: string | null
          received_at: string
          received_by: string | null
          shipment_id: number
        }
        Insert: {
          cartons_received?: number | null
          dc_no?: string | null
          dn_no?: string | null
          facility_id: number
          gate_pass_no?: string | null
          grn_no: string
          has_discrepancy?: boolean
          id?: never
          invoice_no?: string | null
          notes?: string | null
          received_at?: string
          received_by?: string | null
          shipment_id: number
        }
        Update: {
          cartons_received?: number | null
          dc_no?: string | null
          dn_no?: string | null
          facility_id?: number
          gate_pass_no?: string | null
          grn_no?: string
          has_discrepancy?: boolean
          id?: never
          invoice_no?: string | null
          notes?: string | null
          received_at?: string
          received_by?: string | null
          shipment_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "grns_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grns_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: true
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
        ]
      }
      item_imports: {
        Row: {
          created_at: string
          created_by: string | null
          disabled: number
          file_name: string | null
          finished_at: string | null
          id: number
          inserted: number
          status: string
          total_rows: number
          updated: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          disabled?: number
          file_name?: string | null
          finished_at?: string | null
          id?: never
          inserted?: number
          status?: string
          total_rows?: number
          updated?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          disabled?: number
          file_name?: string | null
          finished_at?: string | null
          id?: never
          inserted?: number
          status?: string
          total_rows?: number
          updated?: number
        }
        Relationships: []
      }
      items: {
        Row: {
          base_price: number | null
          brand: string | null
          category_code: string | null
          category_name: string | null
          color: string | null
          cost_price: number | null
          created_at: string
          description: string | null
          ean: string | null
          enabled: boolean
          gst_pct: number | null
          height_mm: number | null
          hsn_code: string | null
          image_url: string | null
          item_type: string
          last_import_id: number | null
          length_mm: number | null
          mrp: number | null
          name: string
          product_url: string | null
          scan_identifier: string | null
          size: string | null
          sku: string
          sub_category: string | null
          uniware_updated_at: string | null
          updated_at: string
          weight_g: number | null
          width_mm: number | null
        }
        Insert: {
          base_price?: number | null
          brand?: string | null
          category_code?: string | null
          category_name?: string | null
          color?: string | null
          cost_price?: number | null
          created_at?: string
          description?: string | null
          ean?: string | null
          enabled?: boolean
          gst_pct?: number | null
          height_mm?: number | null
          hsn_code?: string | null
          image_url?: string | null
          item_type?: string
          last_import_id?: number | null
          length_mm?: number | null
          mrp?: number | null
          name: string
          product_url?: string | null
          scan_identifier?: string | null
          size?: string | null
          sku: string
          sub_category?: string | null
          uniware_updated_at?: string | null
          updated_at?: string
          weight_g?: number | null
          width_mm?: number | null
        }
        Update: {
          base_price?: number | null
          brand?: string | null
          category_code?: string | null
          category_name?: string | null
          color?: string | null
          cost_price?: number | null
          created_at?: string
          description?: string | null
          ean?: string | null
          enabled?: boolean
          gst_pct?: number | null
          height_mm?: number | null
          hsn_code?: string | null
          image_url?: string | null
          item_type?: string
          last_import_id?: number | null
          length_mm?: number | null
          mrp?: number | null
          name?: string
          product_url?: string | null
          scan_identifier?: string | null
          size?: string | null
          sku?: string
          sub_category?: string | null
          uniware_updated_at?: string | null
          updated_at?: string
          weight_g?: number | null
          width_mm?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "items_last_import_id_fkey"
            columns: ["last_import_id"]
            isOneToOne: false
            referencedRelation: "item_imports"
            referencedColumns: ["id"]
          },
        ]
      }
      order_request_lines: {
        Row: {
          bucket: Database["public"]["Enums"]["stock_bucket"]
          gst_pct: number
          id: number
          margin_pct: number
          msp: number
          notes: string | null
          qty: number
          request_id: number
          sku: string
          suggested_qty: number | null
          unit_price: number | null
        }
        Insert: {
          bucket?: Database["public"]["Enums"]["stock_bucket"]
          gst_pct?: number
          id?: never
          margin_pct?: number
          msp?: number
          notes?: string | null
          qty: number
          request_id: number
          sku: string
          suggested_qty?: number | null
          unit_price?: number | null
        }
        Update: {
          bucket?: Database["public"]["Enums"]["stock_bucket"]
          gst_pct?: number
          id?: never
          margin_pct?: number
          msp?: number
          notes?: string | null
          qty?: number
          request_id?: number
          sku?: string
          suggested_qty?: number | null
          unit_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "order_request_lines_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "order_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_request_lines_sku_fkey"
            columns: ["sku"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["sku"]
          },
        ]
      }
      order_requests: {
        Row: {
          closed_at: string | null
          created_at: string
          created_by: string | null
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          demand_run_id: number | null
          facility_id: number
          id: number
          lines_edited_at: string | null
          notes: string | null
          po_no: string | null
          request_no: string
          sent_for_approval_at: string | null
          sent_for_approval_by: string | null
          source: string
          status: Database["public"]["Enums"]["request_status"]
          submitted_at: string | null
          submitted_by: string | null
          warehouse_id: number | null
        }
        Insert: {
          closed_at?: string | null
          created_at?: string
          created_by?: string | null
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          demand_run_id?: number | null
          facility_id: number
          id?: never
          lines_edited_at?: string | null
          notes?: string | null
          po_no?: string | null
          request_no: string
          sent_for_approval_at?: string | null
          sent_for_approval_by?: string | null
          source?: string
          status?: Database["public"]["Enums"]["request_status"]
          submitted_at?: string | null
          submitted_by?: string | null
          warehouse_id?: number | null
        }
        Update: {
          closed_at?: string | null
          created_at?: string
          created_by?: string | null
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          demand_run_id?: number | null
          facility_id?: number
          id?: never
          lines_edited_at?: string | null
          notes?: string | null
          po_no?: string | null
          request_no?: string
          sent_for_approval_at?: string | null
          sent_for_approval_by?: string | null
          source?: string
          status?: Database["public"]["Enums"]["request_status"]
          submitted_at?: string | null
          submitted_by?: string | null
          warehouse_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "order_requests_demand_run_id_fkey"
            columns: ["demand_run_id"]
            isOneToOne: false
            referencedRelation: "demand_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_requests_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_requests_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          facility_id: number | null
          full_name: string | null
          id: string
          is_active: boolean
          role: Database["public"]["Enums"]["user_role"]
        }
        Insert: {
          created_at?: string
          email?: string | null
          facility_id?: number | null
          full_name?: string | null
          id: string
          is_active?: boolean
          role?: Database["public"]["Enums"]["user_role"]
        }
        Update: {
          created_at?: string
          email?: string | null
          facility_id?: number | null
          full_name?: string | null
          id?: string
          is_active?: boolean
          role?: Database["public"]["Enums"]["user_role"]
        }
        Relationships: [
          {
            foreignKeyName: "profiles_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_lines: {
        Row: {
          bucket: Database["public"]["Enums"]["stock_bucket"]
          gst_pct: number
          id: number
          margin_pct: number
          msp: number
          payable_unit: number | null
          qty: number
          sale_id: number
          sku: string
        }
        Insert: {
          bucket?: Database["public"]["Enums"]["stock_bucket"]
          gst_pct?: number
          id?: never
          margin_pct?: number
          msp?: number
          payable_unit?: number | null
          qty: number
          sale_id: number
          sku: string
        }
        Update: {
          bucket?: Database["public"]["Enums"]["stock_bucket"]
          gst_pct?: number
          id?: never
          margin_pct?: number
          msp?: number
          payable_unit?: number | null
          qty?: number
          sale_id?: number
          sku?: string
        }
        Relationships: [
          {
            foreignKeyName: "sale_lines_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_lines_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "v_sales_lines"
            referencedColumns: ["sale_id"]
          },
          {
            foreignKeyName: "sale_lines_sku_fkey"
            columns: ["sku"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["sku"]
          },
        ]
      }
      sales: {
        Row: {
          bill_ref: string | null
          created_by: string | null
          customer_name: string | null
          customer_phone: string | null
          facility_id: number
          id: number
          notes: string | null
          sale_no: string
          sold_at: string
        }
        Insert: {
          bill_ref?: string | null
          created_by?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          facility_id: number
          id?: never
          notes?: string | null
          sale_no: string
          sold_at?: string
        }
        Update: {
          bill_ref?: string | null
          created_by?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          facility_id?: number
          id?: never
          notes?: string | null
          sale_no?: string
          sold_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
        ]
      }
      season_factors: {
        Row: {
          category_name: string
          factor: number
          month: number
        }
        Insert: {
          category_name: string
          factor?: number
          month: number
        }
        Update: {
          category_name?: string
          factor?: number
          month?: number
        }
        Relationships: []
      }
      shipment_lines: {
        Row: {
          fo_line_id: number | null
          id: number
          is_substitute: boolean
          qty: number
          request_line_id: number | null
          shipment_id: number
          sku: string
        }
        Insert: {
          fo_line_id?: number | null
          id?: never
          is_substitute?: boolean
          qty: number
          request_line_id?: number | null
          shipment_id: number
          sku: string
        }
        Update: {
          fo_line_id?: number | null
          id?: never
          is_substitute?: boolean
          qty?: number
          request_line_id?: number | null
          shipment_id?: number
          sku?: string
        }
        Relationships: [
          {
            foreignKeyName: "shipment_lines_fo_line_id_fkey"
            columns: ["fo_line_id"]
            isOneToOne: false
            referencedRelation: "fulfilment_order_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_lines_fo_line_id_fkey"
            columns: ["fo_line_id"]
            isOneToOne: false
            referencedRelation: "v_fo_lines"
            referencedColumns: ["fo_line_id"]
          },
          {
            foreignKeyName: "shipment_lines_request_line_id_fkey"
            columns: ["request_line_id"]
            isOneToOne: false
            referencedRelation: "order_request_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_lines_request_line_id_fkey"
            columns: ["request_line_id"]
            isOneToOne: false
            referencedRelation: "v_request_lines"
            referencedColumns: ["request_line_id"]
          },
          {
            foreignKeyName: "shipment_lines_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_lines_sku_fkey"
            columns: ["sku"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["sku"]
          },
        ]
      }
      shipments: {
        Row: {
          awb_no: string | null
          carton_count: number | null
          courier: string | null
          created_at: string
          created_by: string | null
          dc_no: string | null
          delivered_at: string | null
          dispatched_at: string
          dn_no: string | null
          facility_id: number
          from_facility_id: number | null
          fulfilment_order_id: number | null
          id: number
          invoice_no: string | null
          notes: string | null
          request_id: number
          shipment_no: string
          status: Database["public"]["Enums"]["shipment_status"]
          uniware_ref: string | null
        }
        Insert: {
          awb_no?: string | null
          carton_count?: number | null
          courier?: string | null
          created_at?: string
          created_by?: string | null
          dc_no?: string | null
          delivered_at?: string | null
          dispatched_at?: string
          dn_no?: string | null
          facility_id: number
          from_facility_id?: number | null
          fulfilment_order_id?: number | null
          id?: never
          invoice_no?: string | null
          notes?: string | null
          request_id: number
          shipment_no: string
          status?: Database["public"]["Enums"]["shipment_status"]
          uniware_ref?: string | null
        }
        Update: {
          awb_no?: string | null
          carton_count?: number | null
          courier?: string | null
          created_at?: string
          created_by?: string | null
          dc_no?: string | null
          delivered_at?: string | null
          dispatched_at?: string
          dn_no?: string | null
          facility_id?: number
          from_facility_id?: number | null
          fulfilment_order_id?: number | null
          id?: never
          invoice_no?: string | null
          notes?: string | null
          request_id?: number
          shipment_no?: string
          status?: Database["public"]["Enums"]["shipment_status"]
          uniware_ref?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shipments_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_from_facility_id_fkey"
            columns: ["from_facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_fulfilment_order_id_fkey"
            columns: ["fulfilment_order_id"]
            isOneToOne: false
            referencedRelation: "fulfilment_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "order_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_balances: {
        Row: {
          bucket: Database["public"]["Enums"]["stock_bucket"]
          facility_id: number
          qty: number
          sku: string
          updated_at: string
        }
        Insert: {
          bucket: Database["public"]["Enums"]["stock_bucket"]
          facility_id: number
          qty?: number
          sku: string
          updated_at?: string
        }
        Update: {
          bucket?: Database["public"]["Enums"]["stock_bucket"]
          facility_id?: number
          qty?: number
          sku?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_balances_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_balances_sku_fkey"
            columns: ["sku"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["sku"]
          },
        ]
      }
      stock_count_lines: {
        Row: {
          bucket: Database["public"]["Enums"]["stock_bucket"]
          count_id: number
          counted_qty: number
          id: number
          sku: string
          system_qty: number
          variance: number | null
        }
        Insert: {
          bucket: Database["public"]["Enums"]["stock_bucket"]
          count_id: number
          counted_qty: number
          id?: never
          sku: string
          system_qty: number
          variance?: number | null
        }
        Update: {
          bucket?: Database["public"]["Enums"]["stock_bucket"]
          count_id?: number
          counted_qty?: number
          id?: never
          sku?: string
          system_qty?: number
          variance?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_count_lines_count_id_fkey"
            columns: ["count_id"]
            isOneToOne: false
            referencedRelation: "stock_counts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_count_lines_sku_fkey"
            columns: ["sku"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["sku"]
          },
        ]
      }
      stock_counts: {
        Row: {
          count_no: string
          counted_by: string | null
          facility_id: number
          id: number
          notes: string | null
          posted_at: string
        }
        Insert: {
          count_no: string
          counted_by?: string | null
          facility_id: number
          id?: never
          notes?: string | null
          posted_at?: string
        }
        Update: {
          count_no?: string
          counted_by?: string | null
          facility_id?: number
          id?: never
          notes?: string | null
          posted_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_counts_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_issue_lines: {
        Row: {
          bucket: Database["public"]["Enums"]["stock_bucket"]
          id: number
          issue_id: number
          qty: number
          sku: string
        }
        Insert: {
          bucket: Database["public"]["Enums"]["stock_bucket"]
          id?: never
          issue_id: number
          qty: number
          sku: string
        }
        Update: {
          bucket?: Database["public"]["Enums"]["stock_bucket"]
          id?: never
          issue_id?: number
          qty?: number
          sku?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_issue_lines_issue_id_fkey"
            columns: ["issue_id"]
            isOneToOne: false
            referencedRelation: "stock_issues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_issue_lines_sku_fkey"
            columns: ["sku"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["sku"]
          },
        ]
      }
      stock_issues: {
        Row: {
          created_at: string
          created_by: string | null
          facility_id: number
          id: number
          issue_no: string
          issued_to: string | null
          notes: string | null
          purpose: Database["public"]["Enums"]["issue_purpose"]
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          facility_id: number
          id?: never
          issue_no: string
          issued_to?: string | null
          notes?: string | null
          purpose: Database["public"]["Enums"]["issue_purpose"]
        }
        Update: {
          created_at?: string
          created_by?: string | null
          facility_id?: number
          id?: never
          issue_no?: string
          issued_to?: string | null
          notes?: string | null
          purpose?: Database["public"]["Enums"]["issue_purpose"]
        }
        Relationships: [
          {
            foreignKeyName: "stock_issues_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_ledger: {
        Row: {
          bucket: Database["public"]["Enums"]["stock_bucket"]
          created_at: string
          created_by: string | null
          facility_id: number
          id: number
          movement: Database["public"]["Enums"]["movement_type"]
          note: string | null
          qty_delta: number
          ref_id: number | null
          ref_no: string | null
          ref_type: string
          sku: string
        }
        Insert: {
          bucket: Database["public"]["Enums"]["stock_bucket"]
          created_at?: string
          created_by?: string | null
          facility_id: number
          id?: never
          movement: Database["public"]["Enums"]["movement_type"]
          note?: string | null
          qty_delta: number
          ref_id?: number | null
          ref_no?: string | null
          ref_type: string
          sku: string
        }
        Update: {
          bucket?: Database["public"]["Enums"]["stock_bucket"]
          created_at?: string
          created_by?: string | null
          facility_id?: number
          id?: never
          movement?: Database["public"]["Enums"]["movement_type"]
          note?: string | null
          qty_delta?: number
          ref_id?: number | null
          ref_no?: string | null
          ref_type?: string
          sku?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_ledger_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_ledger_sku_fkey"
            columns: ["sku"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["sku"]
          },
        ]
      }
      wh_return_lines: {
        Row: {
          bucket: Database["public"]["Enums"]["stock_bucket"]
          id: number
          qty: number
          reason: string | null
          return_id: number
          sku: string
        }
        Insert: {
          bucket: Database["public"]["Enums"]["stock_bucket"]
          id?: never
          qty: number
          reason?: string | null
          return_id: number
          sku: string
        }
        Update: {
          bucket?: Database["public"]["Enums"]["stock_bucket"]
          id?: never
          qty?: number
          reason?: string | null
          return_id?: number
          sku?: string
        }
        Relationships: [
          {
            foreignKeyName: "wh_return_lines_return_id_fkey"
            columns: ["return_id"]
            isOneToOne: false
            referencedRelation: "wh_returns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wh_return_lines_sku_fkey"
            columns: ["sku"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["sku"]
          },
        ]
      }
      wh_returns: {
        Row: {
          awb_no: string | null
          carton_count: number | null
          courier: string | null
          created_at: string
          created_by: string | null
          facility_id: number
          grn_id: number | null
          id: number
          notes: string | null
          origin: string
          received_at: string | null
          received_by: string | null
          return_no: string
          status: string
          to_facility_id: number | null
        }
        Insert: {
          awb_no?: string | null
          carton_count?: number | null
          courier?: string | null
          created_at?: string
          created_by?: string | null
          facility_id: number
          grn_id?: number | null
          id?: never
          notes?: string | null
          origin?: string
          received_at?: string | null
          received_by?: string | null
          return_no: string
          status?: string
          to_facility_id?: number | null
        }
        Update: {
          awb_no?: string | null
          carton_count?: number | null
          courier?: string | null
          created_at?: string
          created_by?: string | null
          facility_id?: number
          grn_id?: number | null
          id?: never
          notes?: string | null
          origin?: string
          received_at?: string | null
          received_by?: string | null
          return_no?: string
          status?: string
          to_facility_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "wh_returns_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wh_returns_grn_id_fkey"
            columns: ["grn_id"]
            isOneToOne: false
            referencedRelation: "grns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wh_returns_warehouse_id_fkey"
            columns: ["to_facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      v_fo_lines: {
        Row: {
          bucket: Database["public"]["Enums"]["stock_bucket"] | null
          color: string | null
          dispatched_qty: number | null
          facility_id: number | null
          fo_id: number | null
          fo_line_id: number | null
          fo_no: string | null
          fo_status: Database["public"]["Enums"]["fo_status"] | null
          fulfiller_id: number | null
          gst_pct: number | null
          hsn_code: string | null
          item_name: string | null
          line_gst: number | null
          line_taxable: number | null
          line_total: number | null
          margin_pct: number | null
          msp: number | null
          pending_qty: number | null
          po_no: string | null
          qty: number | null
          request_id: number | null
          request_line_id: number | null
          request_no: string | null
          size: string | null
          sku: string | null
          unit_price: number | null
        }
        Relationships: [
          {
            foreignKeyName: "fulfilment_order_lines_fo_id_fkey"
            columns: ["fo_id"]
            isOneToOne: false
            referencedRelation: "fulfilment_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fulfilment_order_lines_request_line_id_fkey"
            columns: ["request_line_id"]
            isOneToOne: false
            referencedRelation: "order_request_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fulfilment_order_lines_request_line_id_fkey"
            columns: ["request_line_id"]
            isOneToOne: false
            referencedRelation: "v_request_lines"
            referencedColumns: ["request_line_id"]
          },
          {
            foreignKeyName: "fulfilment_order_lines_sku_fkey"
            columns: ["sku"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["sku"]
          },
          {
            foreignKeyName: "fulfilment_orders_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fulfilment_orders_fulfiller_id_fkey"
            columns: ["fulfiller_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fulfilment_orders_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "order_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      v_request_lines: {
        Row: {
          bucket: Database["public"]["Enums"]["stock_bucket"] | null
          category_name: string | null
          color: string | null
          created_at: string | null
          damaged_qty: number | null
          dispatched_qty: number | null
          facility_id: number | null
          gst_pct: number | null
          hsn_code: string | null
          item_name: string | null
          line_gst: number | null
          line_taxable: number | null
          line_total: number | null
          margin_pct: number | null
          msp: number | null
          pending_dispatch_qty: number | null
          po_no: string | null
          received_qty: number | null
          rejected_qty: number | null
          request_id: number | null
          request_line_id: number | null
          request_no: string | null
          request_status: Database["public"]["Enums"]["request_status"] | null
          requested_qty: number | null
          size: string | null
          sku: string | null
          substituted_qty: number | null
          suggested_qty: number | null
          unit_price: number | null
        }
        Relationships: [
          {
            foreignKeyName: "order_request_lines_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "order_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_request_lines_sku_fkey"
            columns: ["sku"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["sku"]
          },
          {
            foreignKeyName: "order_requests_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
        ]
      }
      v_sales_lines: {
        Row: {
          bill_ref: string | null
          bucket: Database["public"]["Enums"]["stock_bucket"] | null
          category_name: string | null
          customer_name: string | null
          customer_phone: string | null
          facility_code: string | null
          facility_id: number | null
          facility_name: string | null
          gross_msp: number | null
          gst_pct: number | null
          item_name: string | null
          margin_pct: number | null
          msp: number | null
          payable_taxable: number | null
          payable_total: number | null
          payable_unit: number | null
          period: string | null
          qty: number | null
          sale_id: number | null
          sale_no: string | null
          sku: string | null
          sold_at: string | null
          sold_on: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sale_lines_sku_fkey"
            columns: ["sku"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["sku"]
          },
          {
            foreignKeyName: "sales_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
        ]
      }
      v_stock: {
        Row: {
          bucket: Database["public"]["Enums"]["stock_bucket"] | null
          category_name: string | null
          color: string | null
          enabled: boolean | null
          facility_code: string | null
          facility_id: number | null
          facility_name: string | null
          item_name: string | null
          max_qty: number | null
          min_qty: number | null
          msp: number | null
          qty: number | null
          size: string | null
          sku: string | null
          updated_at: string | null
          value_cost: number | null
          value_msp: number | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_balances_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_balances_sku_fkey"
            columns: ["sku"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["sku"]
          },
        ]
      }
    }
    Functions: {
      _demand_lines: {
        Args: { p_facility_id: number }
        Returns: {
          bucket: Database["public"]["Enums"]["stock_bucket"]
          category_name: string
          in_transit: number
          item_name: string
          lead_time_days: number
          max_qty: number
          min_qty: number
          on_hand: number
          pending: number
          season_factor: number
          sku: string
          sold_30d: number
          suggested_qty: number
          target: number
          velocity: number
        }[]
      }
      _generate_demand_drafts: {
        Args: { p_facility_id: number; p_run_by: string; p_trigger: string }
        Returns: number
      }
      _refresh_fo_status: { Args: { p_fo_id: number }; Returns: undefined }
      _replace_request_lines: {
        Args: { p_lines: Json; p_request_id: number }
        Returns: undefined
      }
      _route_request: { Args: { p_request_id: number }; Returns: undefined }
      _sku_allowed: {
        Args: { p_facility_id: number; p_sku: string }
        Returns: boolean
      }
      add_grn_photo: {
        Args: { p_grn_id: number; p_grn_line_id: number; p_path: string }
        Returns: number
      }
      approve_request: {
        Args: { p_note: string; p_request_id: number }
        Returns: undefined
      }
      assert_facility_access: {
        Args: { p_facility_id: number }
        Returns: undefined
      }
      assert_ops: { Args: never; Returns: undefined }
      auth_facility: { Args: never; Returns: number }
      auth_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      available_qty: {
        Args: { p_fulfiller_id: number; p_sku: string }
        Returns: number
      }
      can_access_facility: { Args: { p_facility_id: number }; Returns: boolean }
      create_order_request: {
        Args: {
          p_facility_id: number
          p_lines: Json
          p_notes: string
          p_submit?: boolean
          p_warehouse_id: number
        }
        Returns: number
      }
      create_sale: {
        Args: { p_facility_id: number; p_header: Json; p_lines: Json }
        Returns: number
      }
      create_stock_issue: {
        Args: {
          p_facility_id: number
          p_issued_to: string
          p_lines: Json
          p_notes: string
          p_purpose: Database["public"]["Enums"]["issue_purpose"]
        }
        Returns: number
      }
      create_wh_return: {
        Args: { p_facility_id: number; p_header: Json; p_lines: Json }
        Returns: number
      }
      default_warehouse_id: { Args: never; Returns: number }
      demand_suggestions: {
        Args: { p_facility_id: number }
        Returns: {
          bucket: Database["public"]["Enums"]["stock_bucket"]
          category_name: string
          in_transit: number
          item_name: string
          lead_time_days: number
          max_qty: number
          min_qty: number
          on_hand: number
          pending: number
          season_factor: number
          sku: string
          sold_30d: number
          suggested_qty: number
          target: number
          velocity: number
        }[]
      }
      dispatch_fulfilment_order: {
        Args: { p_fo_id: number; p_header: Json; p_lines: Json }
        Returns: number
      }
      finish_item_import: {
        Args: { p_disable_missing: boolean; p_import_id: number }
        Returns: Json
      }
      import_items_chunk: {
        Args: { p_import_id: number; p_rows: Json }
        Returns: Json
      }
      is_admin: { Args: never; Returns: boolean }
      is_manager: { Args: never; Returns: boolean }
      is_ops: { Args: never; Returns: boolean }
      is_super_admin: { Args: never; Returns: boolean }
      move_stock: {
        Args: {
          p_facility_id: number
          p_from: Database["public"]["Enums"]["stock_bucket"]
          p_note: string
          p_qty: number
          p_sku: string
          p_to: Database["public"]["Enums"]["stock_bucket"]
        }
        Returns: undefined
      }
      next_doc_no: { Args: { p_prefix: string }; Returns: string }
      post_grn: {
        Args: { p_header: Json; p_lines: Json; p_shipment_id: number }
        Returns: number
      }
      post_stock_count: {
        Args: { p_facility_id: number; p_lines: Json; p_notes: string }
        Returns: number
      }
      price_for: {
        Args: { p_facility_id: number; p_sku: string }
        Returns: {
          gst_pct: number
          margin_pct: number
          msp: number
        }[]
      }
      receive_return: { Args: { p_return_id: number }; Returns: undefined }
      refresh_request_status: {
        Args: { p_request_id: number }
        Returns: undefined
      }
      reject_request: {
        Args: { p_note: string; p_request_id: number }
        Returns: undefined
      }
      reserved_qty: {
        Args: { p_fulfiller_id: number; p_sku: string }
        Returns: number
      }
      resolve_quarantine: {
        Args: {
          p_action: string
          p_bucket: Database["public"]["Enums"]["stock_bucket"]
          p_facility_id: number
          p_note: string
          p_qty: number
          p_sku: string
          p_to_facility_id: number
        }
        Returns: number
      }
      run_demand_planning: { Args: { p_facility_id: number }; Returns: number }
      send_for_approval: { Args: { p_request_id: number }; Returns: undefined }
      set_request_state: {
        Args: {
          p_request_id: number
          p_status: Database["public"]["Enums"]["request_status"]
        }
        Returns: undefined
      }
      start_item_import: {
        Args: { p_file_name: string; p_total_rows: number }
        Returns: number
      }
      try_numeric: { Args: { p: string }; Returns: number }
      update_request_lines: {
        Args: { p_lines: Json; p_notes: string; p_request_id: number }
        Returns: undefined
      }
    }
    Enums: {
      discrepancy_reason:
        | "ok"
        | "short"
        | "excess"
        | "damaged"
        | "wrong_sku"
        | "rejected"
      facility_type: "warehouse" | "retailer" | "internal" | "super_stockist"
      fo_status:
        | "open"
        | "partially_dispatched"
        | "dispatched"
        | "closed"
        | "cancelled"
      issue_purpose:
        | "training"
        | "demo"
        | "sample"
        | "internal_use"
        | "lost"
        | "scrapped"
      movement_type:
        | "receipt"
        | "sale"
        | "count_adjustment"
        | "bucket_transfer"
        | "issue"
        | "return_to_wh"
        | "dispatch"
        | "return_in"
      request_status:
        | "draft"
        | "submitted"
        | "pending_approval"
        | "approved"
        | "rejected"
        | "partially_dispatched"
        | "dispatched"
        | "received"
        | "closed"
        | "cancelled"
      shipment_status: "in_transit" | "received"
      stock_bucket: "sellable" | "display" | "in_use" | "damaged" | "quarantine"
      user_role: "super_admin" | "admin" | "manager" | "ops" | "facility_staff"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      discrepancy_reason: [
        "ok",
        "short",
        "excess",
        "damaged",
        "wrong_sku",
        "rejected",
      ],
      facility_type: ["warehouse", "retailer", "internal", "super_stockist"],
      fo_status: [
        "open",
        "partially_dispatched",
        "dispatched",
        "closed",
        "cancelled",
      ],
      issue_purpose: [
        "training",
        "demo",
        "sample",
        "internal_use",
        "lost",
        "scrapped",
      ],
      movement_type: [
        "receipt",
        "sale",
        "count_adjustment",
        "bucket_transfer",
        "issue",
        "return_to_wh",
        "dispatch",
        "return_in",
      ],
      request_status: [
        "draft",
        "submitted",
        "pending_approval",
        "approved",
        "rejected",
        "partially_dispatched",
        "dispatched",
        "received",
        "closed",
        "cancelled",
      ],
      shipment_status: ["in_transit", "received"],
      stock_bucket: ["sellable", "display", "in_use", "damaged", "quarantine"],
      user_role: ["super_admin", "admin", "manager", "ops", "facility_staff"],
    },
  },
} as const
