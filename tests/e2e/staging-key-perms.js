'use strict';
/* STAGING:s skrivbehörighet per nyckel — kopia av KEY_PERMISSIONS i
   store-key-write v3 (STAGING-repot: _staging_integration/server/candidate/
   20261117/store-key-write/index.ts; installerad 2026-11-17 enligt
   DEPLOY_RESULT_20261117.md). Nyckel som saknas här nekas av servern. */
module.exports = {
  vift_customers: 'customer_manage', vift_properties: 'customer_manage', vift_propertyContacts: 'customer_manage',
  vift_propertyRoles: 'customer_manage', vift_propertyCategories: 'customer_manage', vift_propertyObjects: 'customer_manage',
  vift_deviationCategories: 'customer_manage', vift_inspections: 'customer_manage', vift_contracts: 'customer_manage',
  vift_offers: 'offer_manage', vift_salesOpps: 'sales_manage', vift_recurringOrders: 'recurring_manage',
  vift_ronderingar: 'ao_view_all', vift_ronderingsmallar: 'ao_view_all', vift_avvikelser: 'ao_view_all',
  vift_staff: 'staff_manage', vift_roles: 'admin_manage', vift_settings: 'admin_manage', vift_titles: 'admin_manage',
  vift_articles: 'article_manage', vift_priceGroups: 'article_manage', vift_priceProfiles: 'article_manage',
  vift_serviceTemplates: 'admin_manage', vift_emailTemplates: 'admin_manage', vift_activities: 'admin_manage',
  vift_activityLog: 'admin_manage', vift_importLogs: 'admin_manage', vift_projects: 'customer_manage',
};
