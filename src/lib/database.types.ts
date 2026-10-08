
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "audit_log": {
                  Row: {
                    "action": string,"created_at": string | null,"data": Json | null,"entity": string | null,"entity_id": string | null,"id": number,"member_id": string | null,"tenant_id": string
                  }
                  Insert: {
                    "action": string,"created_at"?: string | null,"data"?: Json | null,"entity"?: string | null,"entity_id"?: string | null,"id"?: number,"member_id"?: string | null,"tenant_id": string
                  }
                  Update: {
                    "action"?: string,"created_at"?: string | null,"data"?: Json | null,"entity"?: string | null,"entity_id"?: string | null,"id"?: number,"member_id"?: string | null,"tenant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "audit_log_member_id_fkey"
      columns: ["member_id"]
isOneToOne: false
      referencedRelation: "members"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "audit_log_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"call_attempts": {
                  Row: {
                    "callback_at": string | null,"created_at": string | null,"customer_id": string,"id": string,"member_id": string,"note": string | null,"outcome": string,"tenant_id": string
                  }
                  Insert: {
                    "callback_at"?: string | null,"created_at"?: string | null,"customer_id": string,"id"?: string,"member_id": string,"note"?: string | null,"outcome": string,"tenant_id": string
                  }
                  Update: {
                    "callback_at"?: string | null,"created_at"?: string | null,"customer_id"?: string,"id"?: string,"member_id"?: string,"note"?: string | null,"outcome"?: string,"tenant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "call_attempts_tenant_id_customer_id_fkey"
      columns: ["tenant_id","customer_id"]
isOneToOne: false
      referencedRelation: "customers"
      referencedColumns: ["tenant_id","id"]
    },{
      foreignKeyName: "call_attempts_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "call_attempts_tenant_id_member_id_fkey"
      columns: ["tenant_id","member_id"]
isOneToOne: false
      referencedRelation: "members"
      referencedColumns: ["tenant_id","id"]
    }
                  ]
                },"customers": {
                  Row: {
                    "amount": string | null,"revive_active": boolean,"revived_at": string | null,"revived_by": string | null,"applied_at": string | null,"appointment_day": string | null,"appointment_time": string | null,"assigned_to": string | null,"attempts_in_round": number,"birth_date": string | null,"call_status": string,"consent": boolean,"created_at": string | null,"full_name": string,"id": string,"last_note": string | null,"last_outcome": string | null,"next_call_at": string,"operator": string | null,"phone": string,"phone_alt": string | null,"pipeline_stage": string | null,"pool_count": number,"source": string,"source_detail": string | null,"tenant_id": string,"updated_at": string | null
                  }
                  Insert: {
                    "amount"?: string | null,"revive_active"?: boolean,"revived_at"?: string | null,"revived_by"?: string | null,"applied_at"?: string | null,"appointment_day"?: string | null,"appointment_time"?: string | null,"assigned_to"?: string | null,"attempts_in_round"?: number,"birth_date"?: string | null,"call_status"?: string,"consent"?: boolean,"created_at"?: string | null,"full_name": string,"id"?: string,"last_note"?: string | null,"last_outcome"?: string | null,"next_call_at"?: string,"operator"?: string | null,"phone": string,"phone_alt"?: string | null,"pipeline_stage"?: string | null,"pool_count"?: number,"source"?: string,"source_detail"?: string | null,"tenant_id": string,"updated_at"?: string | null
                  }
                  Update: {
                    "amount"?: string | null,"revive_active"?: boolean,"revived_at"?: string | null,"revived_by"?: string | null,"applied_at"?: string | null,"appointment_day"?: string | null,"appointment_time"?: string | null,"assigned_to"?: string | null,"attempts_in_round"?: number,"birth_date"?: string | null,"call_status"?: string,"consent"?: boolean,"created_at"?: string | null,"full_name"?: string,"id"?: string,"last_note"?: string | null,"last_outcome"?: string | null,"next_call_at"?: string,"operator"?: string | null,"phone"?: string,"phone_alt"?: string | null,"pipeline_stage"?: string | null,"pool_count"?: number,"source"?: string,"source_detail"?: string | null,"tenant_id"?: string,"updated_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "customers_tenant_id_assigned_to_fkey"
      columns: ["tenant_id","assigned_to"]
isOneToOne: false
      referencedRelation: "members"
      referencedColumns: ["tenant_id","id"]
    },{
      foreignKeyName: "customers_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"daily_assignments": {
                  Row: {
                    "created_at": string | null,"customer_id": string,"day": string,"id": string,"member_id": string,"position": number,"tenant_id": string
                  }
                  Insert: {
                    "created_at"?: string | null,"customer_id": string,"day": string,"id"?: string,"member_id": string,"position": number,"tenant_id": string
                  }
                  Update: {
                    "created_at"?: string | null,"customer_id"?: string,"day"?: string,"id"?: string,"member_id"?: string,"position"?: number,"tenant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "daily_assignments_tenant_id_customer_id_fkey"
      columns: ["tenant_id","customer_id"]
isOneToOne: false
      referencedRelation: "customers"
      referencedColumns: ["tenant_id","id"]
    },{
      foreignKeyName: "daily_assignments_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "daily_assignments_tenant_id_member_id_fkey"
      columns: ["tenant_id","member_id"]
isOneToOne: false
      referencedRelation: "members"
      referencedColumns: ["tenant_id","id"]
    }
                  ]
                },"members": {
                  Row: {
                    "absent_on": string | null,"accent_color": string | null,"created_at": string | null,"full_name": string,"id": string,"is_active": boolean,"auto_lock_minutes": number,"locked_at": string | null,"pin_failed": number,"pin_hash": string | null,"notify_appointment": boolean,"notify_callback": boolean,"notify_morning": boolean,"notify_summary": boolean,"permissions": NonNullable<Json>,"role": string,"tenant_id": string,"user_id": string | null
                  }
                  Insert: {
                    "absent_on"?: string | null,"accent_color"?: string | null,"created_at"?: string | null,"full_name": string,"id"?: string,"is_active"?: boolean,"auto_lock_minutes"?: number,"locked_at"?: string | null,"pin_failed"?: number,"pin_hash"?: string | null,"notify_appointment"?: boolean,"notify_callback"?: boolean,"notify_morning"?: boolean,"notify_summary"?: boolean,"permissions"?: NonNullable<Json>,"role": string,"tenant_id": string,"user_id": string
                  }
                  Update: {
                    "absent_on"?: string | null,"accent_color"?: string | null,"created_at"?: string | null,"full_name"?: string,"id"?: string,"is_active"?: boolean,"auto_lock_minutes"?: number,"locked_at"?: string | null,"pin_failed"?: number,"pin_hash"?: string | null,"notify_appointment"?: boolean,"notify_callback"?: boolean,"notify_morning"?: boolean,"notify_summary"?: boolean,"permissions"?: NonNullable<Json>,"role"?: string,"tenant_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "members_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"meta_connections": {
                  Row: {
                    "connected_at": string | null,"last_error": string | null,"last_error_at": string | null,"last_lead_at": string | null,"last_sync_at": string | null,"page_id": string,"tenant_id": string
                  }
                  Insert: {
                    "connected_at"?: string | null,"last_error"?: string | null,"last_error_at"?: string | null,"last_lead_at"?: string | null,"last_sync_at"?: string | null,"page_id": string,"tenant_id": string
                  }
                  Update: {
                    "connected_at"?: string | null,"last_error"?: string | null,"last_error_at"?: string | null,"last_lead_at"?: string | null,"last_sync_at"?: string | null,"page_id"?: string,"tenant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "meta_connections_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: true
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"meta_leads": {
                  Row: {
                    "created_time": string | null,"customer_id": string | null,"form_id": string | null,"id": string,"leadgen_id": string,"received_at": string | null,"result": string,"tenant_id": string
                  }
                  Insert: {
                    "created_time"?: string | null,"customer_id"?: string | null,"form_id"?: string | null,"id"?: string,"leadgen_id": string,"received_at"?: string | null,"result": string,"tenant_id": string
                  }
                  Update: {
                    "created_time"?: string | null,"customer_id"?: string | null,"form_id"?: string | null,"id"?: string,"leadgen_id"?: string,"received_at"?: string | null,"result"?: string,"tenant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "meta_leads_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"notification_log": {
                  Row: {
                    "attempts": number,"claimed_at": string,"created_at": string | null,"day": string,"error": string | null,"id": number,"kind": string,"member_id": string,"ref_id": string | null,"status": string,"tenant_id": string
                  }
                  Insert: {
                    "attempts"?: number,"claimed_at"?: string,"created_at"?: string | null,"day": string,"error"?: string | null,"id"?: number,"kind": string,"member_id": string,"ref_id"?: string | null,"status": string,"tenant_id": string
                  }
                  Update: {
                    "attempts"?: number,"claimed_at"?: string,"created_at"?: string | null,"day"?: string,"error"?: string | null,"id"?: number,"kind"?: string,"member_id"?: string,"ref_id"?: string | null,"status"?: string,"tenant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "notification_log_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "notification_log_tenant_id_member_id_fkey"
      columns: ["tenant_id","member_id"]
isOneToOne: false
      referencedRelation: "members"
      referencedColumns: ["tenant_id","id"]
    }
                  ]
                },"pipeline_events": {
                  Row: {
                    "created_at": string | null,"customer_id": string,"id": string,"member_id": string,"note": string | null,"stage": string,"tenant_id": string
                  }
                  Insert: {
                    "created_at"?: string | null,"customer_id": string,"id"?: string,"member_id": string,"note"?: string | null,"stage": string,"tenant_id": string
                  }
                  Update: {
                    "created_at"?: string | null,"customer_id"?: string,"id"?: string,"member_id"?: string,"note"?: string | null,"stage"?: string,"tenant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "pipeline_events_tenant_id_customer_id_fkey"
      columns: ["tenant_id","customer_id"]
isOneToOne: false
      referencedRelation: "customers"
      referencedColumns: ["tenant_id","id"]
    },{
      foreignKeyName: "pipeline_events_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "pipeline_events_tenant_id_member_id_fkey"
      columns: ["tenant_id","member_id"]
isOneToOne: false
      referencedRelation: "members"
      referencedColumns: ["tenant_id","id"]
    }
                  ]
                },"push_subscriptions": {
                  Row: {
                    "auth": string,"created_at": string,"endpoint": string,"id": string,"last_seen_at": string,"member_id": string,"p256dh": string,"tenant_id": string,"user_agent": string | null
                  }
                  Insert: {
                    "auth": string,"created_at"?: string,"endpoint": string,"id"?: string,"last_seen_at"?: string,"member_id": string,"p256dh": string,"tenant_id": string,"user_agent"?: string | null
                  }
                  Update: {
                    "auth"?: string,"created_at"?: string,"endpoint"?: string,"id"?: string,"last_seen_at"?: string,"member_id"?: string,"p256dh"?: string,"tenant_id"?: string,"user_agent"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "push_subscriptions_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "push_subscriptions_tenant_id_member_id_fkey"
      columns: ["tenant_id","member_id"]
isOneToOne: false
      referencedRelation: "members"
      referencedColumns: ["tenant_id","id"]
    }
                  ]
                },"tenant_settings": {
                  Row: {
                    "appointment_lead_minutes": number,"birthday_notice_days": number,"brand_color": string,"brand_name": string,"claim_limit": number,"distribution_hour": number,"distribution_minute": number,"distribution_mode": string,"logo_url": string | null,"max_attempts": number,"max_rounds": number,"pool_wait_days": number,"push_enabled": boolean,"summary_hour": number,"summary_minute": number,"tenant_id": string
                  }
                  Insert: {
                    "appointment_lead_minutes"?: number,"birthday_notice_days"?: number,"brand_color"?: string,"brand_name"?: string,"claim_limit"?: number,"distribution_hour"?: number,"distribution_minute"?: number,"distribution_mode"?: string,"logo_url"?: string | null,"max_attempts"?: number,"max_rounds"?: number,"pool_wait_days"?: number,"push_enabled"?: boolean,"summary_hour"?: number,"summary_minute"?: number,"tenant_id": string
                  }
                  Update: {
                    "appointment_lead_minutes"?: number,"birthday_notice_days"?: number,"brand_color"?: string,"brand_name"?: string,"claim_limit"?: number,"distribution_hour"?: number,"distribution_minute"?: number,"distribution_mode"?: string,"logo_url"?: string | null,"max_attempts"?: number,"max_rounds"?: number,"pool_wait_days"?: number,"push_enabled"?: boolean,"summary_hour"?: number,"summary_minute"?: number,"tenant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "tenant_settings_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: true
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"tenants": {
                  Row: {
                    "created_at": string | null,"id": string,"name": string
                  }
                  Insert: {
                    "created_at"?: string | null,"id"?: string,"name": string
                  }
                  Update: {
                    "created_at"?: string | null,"id"?: string,"name"?: string
                  }
                  Relationships: [
                    
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "_audit":
{ Args: { "p_action": string,"p_data": Json,"p_entity": string,"p_entity_id": string,"p_member": string,"p_tenant": string }; Returns: undefined
                           },
"_can_view":
{ Args: { "c": Database["public"]['Tables']["customers"]['Row'],"m": Database["public"]['Tables']["members"]['Row'] }; Returns: boolean
                           },
"_can_work":
{ Args: { "c": Database["public"]['Tables']["customers"]['Row'],"m": Database["public"]['Tables']["members"]['Row'] }; Returns: boolean
                           },
"_distribute_day_for":
{ Args: { "p_day": string,"p_tenant": string }; Returns: number
                           },
"_has_perm":
{ Args: { "m": Database["public"]['Tables']["members"]['Row'],"p_perm": string }; Returns: boolean
                           },
"_name_initials":
{ Args: { "p": string }; Returns: string
                           },
"_normalize_operator":
{ Args: { "p": string }; Returns: string
                           },
"_notification_claim":
{ Args: { "p_day": string,"p_kind": string,"p_member": string,"p_ref_id"?: string,"p_tenant": string }; Returns: number
                           },
"_notification_done":
{ Args: { "p_day": string,"p_kind": string,"p_member": string,"p_ref_id"?: string }; Returns: boolean
                           },
"_notification_finish":
{ Args: { "p_error": string,"p_id": number,"p_status": string }; Returns: undefined
                           },
"_notification_targets":
{ Args: { "p_now": string }; Returns: {
              "kind": string,"member_id": string,"payload": Json,"ref_id": string,"tenant_id": string
            }[]
                           },
"_recipients":
{ Args: { "p_day": string,"p_exclude"?: string,"p_tenant": string }; Returns: {
              "full_name": string,"id": string
            }[]
                           },
"auth_assigned_today":
{ Args: { "p_customer": string }; Returns: boolean
                           },
"auth_can_view_customer":
{ Args: { "p_customer": string }; Returns: boolean
                           },
"auth_has_perm":
{ Args: { "p_perm": string }; Returns: boolean
                           },
"auth_is_manager":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"auth_member_id":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"auth_tenant_id":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"birthday_in_year":
{ Args: { "p_birth": string,"p_year": number }; Returns: string
                           },
"birthday_next":
{ Args: { "p_birth": string,"p_from": string }; Returns: string
                           },
"current_member":
{ Args: Record<PropertyKey, never>; Returns: {
              "absent_on": string | null,
"created_at": string | null,
"full_name": string,
"id": string,
"is_active": boolean,
"notify_appointment": boolean,
"notify_callback": boolean,
"notify_morning": boolean,
"notify_summary": boolean,
"permissions": NonNullable<Json>,
"role": string,
"tenant_id": string,
"user_id": string
            }
                          SetofOptions: {
        from: "*"
        to: "members"
        isOneToOne: true
        isSetofReturn: false
      } },
"day_summary":
{ Args: { "p_day"?: string }; Returns: {
              "appointments": number,"assigned": number,"done": number,"full_name": string,"member_id": string,"reached": number,"retries": number
            }[]
                           },
"delete_customer":
{ Args: { "p_customer": string,"p_reason"?: string }; Returns: undefined
                           },
"delete_customers":
{ Args: { "p_customers": string[] }; Returns: number
                           },
"delete_all_customers":
{ Args: { "p_expected": number }; Returns: number
                           },
"meta_connect_for":
{ Args: { "p_tenant": string,"p_page_id": string }; Returns: undefined
                           },
"meta_status":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"meta_tenant_for_page":
{ Args: { "p_page_id": string }; Returns: string | null
                           },
"meta_connections_list":
{ Args: Record<PropertyKey, never>; Returns: { tenant_id: string; page_id: string; last_sync_at: string | null }[]
                           },
"ingest_meta_lead":
{ Args: { "p_tenant": string,"p_leadgen_id": string,"p_form_id": string | null,"p_created_time": string | null,"p_full_name": string | null,"p_phone": string | null,"p_note": string | null,"p_source_detail": string | null,"p_operator"?: string | null,"p_phone_alt"?: string | null,"p_amount"?: string | null }; Returns: Json
                           },
"meta_record_status":
{ Args: { "p_tenant": string,"p_ok": boolean,"p_error"?: string | null,"p_synced"?: boolean }; Returns: undefined
                           },
"distribute_day":
{ Args: { "p_day"?: string }; Returns: number
                           },
"import_customers":
{ Args: { "p_rows": Json,"p_source_detail": string }; Returns: Json
                           },
"claim_next":
{ Args: Record<PropertyKey, never>; Returns: Database["public"]["Tables"]["customers"]["Row"]
                           },
"claim_queue_status":
{ Args: Record<PropertyKey, never>; Returns: {
              "claim_limit": number,"mode": string,"open_count": number,"waiting": number
            }[]
                           },
"list_pool":
{ Args: Record<PropertyKey, never>; Returns: {
              "full_name": string,"id": string,"last_member_name": string | null,"last_outcome": string | null,"next_call_at": string,"operator": string | null,"pool_count": number
            }[]
                           },
"log_call":
{ Args: { "p_appointment_day"?: string,"p_appointment_time"?: string,"p_callback_at"?: string,"p_customer": string,"p_note"?: string,"p_outcome": string }; Returns: {
              "applied_at": string | null,
"appointment_day": string | null,
"appointment_time": string | null,
"assigned_to": string | null,
"attempts_in_round": number,
"birth_date": string | null,
"call_status": string,
"consent": boolean,
"created_at": string | null,
"full_name": string,
"id": string,
"last_note": string | null,
"last_outcome": string | null,
"next_call_at": string,
"operator": string | null,
"phone": string,
"phone_alt": string | null,
"pipeline_stage": string | null,
"pool_count": number,
"source": string,
"source_detail": string | null,
"tenant_id": string,
"updated_at": string | null
            }
                          SetofOptions: {
        from: "*"
        to: "customers"
        isOneToOne: true
        isSetofReturn: false
      } },
"log_export":
{ Args: { "p_filters"?: Json,"p_kind": string,"p_rows": number }; Returns: undefined
                           },
"lock_status":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"lock_me":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"unlock_with_pin":
{ Args: { "p_pin": string }; Returns: Json
                           },
"set_my_pin":
{ Args: { "p_new": string,"p_current_pin"?: string }; Returns: undefined
                           },
"set_my_auto_lock_mobile":
{ Args: { "p_minutes": number }; Returns: undefined
                           },
"set_my_auto_lock":
{ Args: { "p_minutes": number }; Returns: undefined
                           },
"reset_member_pin":
{ Args: { "p_member": string }; Returns: undefined
                           },
"anonymize_member":
{ Args: { "p_member": string }; Returns: string
                           },
"auth_unlocked":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"login_branding":
{ Args: Record<PropertyKey, never>; Returns: {
              "brand_color": string,"brand_name": string,"logo_url": string
            }[]
                           },
"mark_absent":
{ Args: { "p_day"?: string,"p_member": string }; Returns: number
                           },
"push_status":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"push_subscribe":
{ Args: { "p_auth": string,"p_endpoint": string,"p_p256dh": string,"p_user_agent"?: string }; Returns: undefined
                           },
"push_team_status":
{ Args: Record<PropertyKey, never>; Returns: {
              "devices": number,"full_name": string,"member_id": string,"notify_appointment": boolean,"notify_callback": boolean
            }[]
                           },
"push_unsubscribe":
{ Args: { "p_endpoint": string }; Returns: undefined
                           },
"normalize_tr_phone":
{ Args: { "p": string }; Returns: string
                           },
"reassign_customer":
{ Args: { "p_customer": string,"p_member": string }; Returns: {
              "applied_at": string | null,
"appointment_day": string | null,
"appointment_time": string | null,
"assigned_to": string | null,
"attempts_in_round": number,
"birth_date": string | null,
"call_status": string,
"consent": boolean,
"created_at": string | null,
"full_name": string,
"id": string,
"last_note": string | null,
"last_outcome": string | null,
"next_call_at": string,
"operator": string | null,
"phone": string,
"phone_alt": string | null,
"pipeline_stage": string | null,
"pool_count": number,
"source": string,
"source_detail": string | null,
"tenant_id": string,
"updated_at": string | null
            }
                          SetofOptions: {
        from: "*"
        to: "customers"
        isOneToOne: true
        isSetofReturn: false
      } },
"reassign_customers":
{ Args: { "p_customers": string[],"p_member": string }; Returns: number
                           },
"archive_list":
{ Args: { "p_from"?: string,"p_limit"?: number,"p_offset"?: number,"p_operator"?: string,"p_outcome"?: string,"p_q"?: string,"p_sort"?: string,"p_to"?: string }; Returns: Json
                           },
"claim_archive_customers":
{ Args: { "p_customers": string[] }; Returns: Json
                           },
"release_customer":
{ Args: { "p_customer": string }; Returns: Database["public"]["Tables"]["customers"]["Row"]
                           },
"report_intake":
{ Args: { "p_from": string,"p_to": string }; Returns: Json
                           },
"report_range":
{ Args: { "p_from": string,"p_to": string }; Returns: Json
                           },
"report_range_member":
{ Args: { "p_from": string,"p_member": string,"p_to": string }; Returns: Json
                           },
"rules_summary_text":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"run_scheduled_distribution":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"set_appointment":
{ Args: { "p_customer": string,"p_day"?: string,"p_time"?: string }; Returns: {
              "applied_at": string | null,
"appointment_day": string | null,
"appointment_time": string | null,
"assigned_to": string | null,
"attempts_in_round": number,
"birth_date": string | null,
"call_status": string,
"consent": boolean,
"created_at": string | null,
"full_name": string,
"id": string,
"last_note": string | null,
"last_outcome": string | null,
"next_call_at": string,
"operator": string | null,
"phone": string,
"phone_alt": string | null,
"pipeline_stage": string | null,
"pool_count": number,
"source": string,
"source_detail": string | null,
"tenant_id": string,
"updated_at": string | null
            }
                          SetofOptions: {
        from: "*"
        to: "customers"
        isOneToOne: true
        isSetofReturn: false
      } },
"set_my_accent":
{ Args: { "p_color": string | null }; Returns: undefined
                           },
"set_push_prefs":
{ Args: { "p_appointment": boolean | null,"p_callback": boolean | null }; Returns: undefined
                           },
"set_push_settings":
{ Args: { "p_enabled": boolean | null,"p_lead": number | null }; Returns: undefined
                           },
"set_pipeline_stage":
{ Args: { "p_customer": string,"p_note"?: string,"p_stage": string }; Returns: {
              "applied_at": string | null,
"appointment_day": string | null,
"appointment_time": string | null,
"assigned_to": string | null,
"attempts_in_round": number,
"birth_date": string | null,
"call_status": string,
"consent": boolean,
"created_at": string | null,
"full_name": string,
"id": string,
"last_note": string | null,
"last_outcome": string | null,
"next_call_at": string,
"operator": string | null,
"phone": string,
"phone_alt": string | null,
"pipeline_stage": string | null,
"pool_count": number,
"source": string,
"source_detail": string | null,
"tenant_id": string,
"updated_at": string | null
            }
                          SetofOptions: {
        from: "*"
        to: "customers"
        isOneToOne: true
        isSetofReturn: false
      } },
"take_from_pool":
{ Args: { "p_customer": string }; Returns: Database["public"]["Tables"]["customers"]["Row"]
                           },
"tr_day_start":
{ Args: { "p_day": string }; Returns: string
                           },
"tr_today":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"transfer_open_work":
{ Args: { "p_day"?: string,"p_from": string,"p_to"?: string }; Returns: number
                           },
"upcoming_birthdays":
{ Args: { "p_days"?: number }; Returns: {
              "birth_date": string,"customer_id": string,"days_left": number,"full_name": string
            }[]
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            
          }
        }
} as const
